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
import { runInTenant } from '../tenancy/request-context';
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

  /** The link token is the identity: look it up with the raw client, then change things inside that visit's business. */
  private async load(token: string): Promise<VisitWithPeople> {
    const visit = await this.prisma.visit.findUnique({
      where: { inviteTokenHash: hashInviteToken(token) },
      include: VISIT_INCLUDE,
    });
    if (!visit) throw new ApiException(404, 'NOT_FOUND', 'This link is not valid.');
    return visit;
  }

  /** What the visitor sees. No phone or other personal data. */
  private view(v: VisitWithPeople) {
    const hasPass = v.status === 'APPROVED' || v.status === 'CHECKED_IN';
    return {
      status: v.status,
      visitorName: v.status === 'INVITED' ? (v.invitedName ?? v.visitor.name) : v.visitor.name,
      hostName: v.host.name,
      siteName: v.premises.name,
      validFrom: v.validFrom.toISOString(),
      validTo: v.validTo.toISOString(),
      pass: hasPass
        ? this.passes.sign({ visitId: v.id, premisesId: v.premisesId, validFrom: v.validFrom, validTo: v.validTo })
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

    // Submitted twice: return the same pass, no error.
    if (visit.status === 'APPROVED' || visit.status === 'CHECKED_IN') {
      res.status(200);
      return this.view(visit);
    }

    // A closed link must never change the visitor's record.
    if (visit.status !== 'INVITED') throw new InvalidTransitionError(visit.status);

    const body = parseBody(registerSchema, rawBody);
    if (!body.consent) {
      throw new ApiException(422, 'CONSENT_REQUIRED', 'Please give consent to continue.');
    }
    if (visit.validTo < new Date()) {
      throw new ApiException(410, 'INVITE_EXPIRED', 'This link has expired. Please ask your host for a new one.');
    }
    if (!body.photoKey.startsWith(`visitors/${visit.id}/`) || !(await this.storage.exists(body.photoKey))) {
      throw new ApiException(422, 'VALIDATION_FAILED', 'Please upload the photo again.');
    }

    const consentAt = new Date();
    try {
      await runInTenant(visit.businessId, () =>
        this.lifecycle.apply({
          visitId: visit.id,
          action: 'REGISTER',
          actorId: null,
          inTx: async (tx) => {
            await tx.visitor.update({
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
          },
        }),
      );
    } catch (error) {
      // Another request won the race: return the same pass.
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
