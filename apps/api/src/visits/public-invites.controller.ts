import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import { Public } from '../auth/roles.decorator';
import { ApiException } from '../common/api-exception';
import { parseBody } from '../common/parse';
import { PassService } from '../passes/pass.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { photoInterceptor, requireJpeg } from '../storage/uploads.controller';
import { InvalidTransitionError } from './errors';
import { hashInviteToken } from './invite-tokens';
import { VisitLifecycleService } from './visit-lifecycle.service';
import { VISIT_INCLUDE, VisitWithPeople } from './visits.service';

const RETENTION_DAYS = 180;

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  company: z.string().trim().max(100).optional(),
  photoKey: z.string().min(1),
  idType: z.string().trim().max(30).optional(),
  idLast4: z.string().regex(/^\d{4}$/).optional(),
  consent: z.boolean(),
});

@Public()
@Throttle({ default: { limit: () => Number(process.env.PUBLIC_RATE_LIMIT ?? 20), ttl: 60_000 } })
@Controller('public/invites/:token')
export class PublicInvitesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: VisitLifecycleService,
    private readonly passes: PassService,
    private readonly storage: StorageService,
  ) {}

  private async load(token: string): Promise<VisitWithPeople> {
    const visit = await this.prisma.visit.findUnique({
      where: { inviteTokenHash: hashInviteToken(token) },
      include: VISIT_INCLUDE,
    });
    if (!visit) throw new ApiException(404, 'NOT_FOUND', 'Yeh link sahi nahi hai.');
    return visit;
  }

  /** Visitor ko dikhne wali jaankari. Phone ya doosra personal data nahi. */
  private view(v: VisitWithPeople) {
    const hasPass = v.status === 'APPROVED' || v.status === 'CHECKED_IN';
    return {
      status: v.status,
      visitorName: v.visitor.name,
      hostName: v.host.name,
      siteName: v.site.name,
      validFrom: v.validFrom.toISOString(),
      validTo: v.validTo.toISOString(),
      pass: hasPass
        ? this.passes.sign({ visitId: v.id, siteId: v.siteId, validFrom: v.validFrom, validTo: v.validTo })
        : null,
    };
  }

  @Get()
  async get(@Param('token') token: string) {
    return this.view(await this.load(token));
  }

  @Post('photo')
  @UseInterceptors(photoInterceptor())
  async photo(@Param('token') token: string, @UploadedFile() file: Express.Multer.File | undefined) {
    const visit = await this.load(token);
    if (visit.status !== 'INVITED') throw new InvalidTransitionError(visit.status);
    const body = requireJpeg(file);
    const key = `visitors/${visit.id}/${randomUUID()}.jpg`;
    await this.storage.put(key, body, 'image/jpeg');
    return { key };
  }

  @Post('register')
  async register(
    @Param('token') token: string,
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const visit = await this.load(token);

    // Do baar submit: wahi pass, koi error nahi.
    if (visit.status === 'APPROVED' || visit.status === 'CHECKED_IN') {
      res.status(200);
      return this.view(visit);
    }

    const body = parseBody(registerSchema, rawBody);
    if (!body.consent) {
      throw new ApiException(422, 'CONSENT_REQUIRED', 'Aage badhne ke liye sahmati dena zaroori hai.');
    }
    if (visit.status === 'INVITED' && visit.validTo < new Date()) {
      throw new ApiException(410, 'INVITE_EXPIRED', 'Is link ka time khatam ho gaya hai. Apne host se naya link maangein.');
    }
    if (!body.photoKey.startsWith(`visitors/${visit.id}/`) || !(await this.storage.exists(body.photoKey))) {
      throw new ApiException(422, 'VALIDATION_FAILED', 'Photo dobara upload karein.');
    }

    const consentAt = new Date();
    await this.prisma.visitor.update({
      where: { id: visit.visitorId },
      data: {
        name: body.name,
        company: body.company,
        photoKey: body.photoKey,
        idType: body.idType,
        idLast4: body.idLast4,
        consentAt,
        consentVersion: process.env.CONSENT_VERSION,
        deleteAfter: new Date(consentAt.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    try {
      await this.lifecycle.apply({ visitId: visit.id, action: 'REGISTER', actorId: null });
    } catch (error) {
      // Doosri request pehle jeet gayi: wahi pass de do.
      const fresh = await this.load(token);
      if (error instanceof InvalidTransitionError && fresh.status === 'APPROVED') {
        res.status(200);
        return this.view(fresh);
      }
      throw error;
    }
    return this.view(await this.load(token));
  }
}
