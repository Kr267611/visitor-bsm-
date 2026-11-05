import { Injectable } from '@nestjs/common';
import type { Prisma, Visit, VisitStatus } from '@prisma/client';
import type { VisitSummary } from '@visitor/shared';
import { AuthUser } from '../auth/roles.decorator';
import { ApiException } from '../common/api-exception';
import { requirePhone } from '../common/parse';
import { istDayRange } from '../common/time';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { inviteLink, newInviteToken } from './invite-tokens';
import { VisitLifecycleService } from './visit-lifecycle.service';

const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
const SITE_STAFF = ['guard', 'reception', 'security', 'admin'];
const DESK_STAFF = ['reception', 'admin'];

export const VISIT_INCLUDE = { visitor: true, host: true, site: true } as const;
export type VisitWithPeople = Prisma.VisitGetPayload<{ include: typeof VISIT_INCLUDE }>;

const forbidden = () => new ApiException(403, 'FORBIDDEN', 'Aapko iski permission nahi hai.');

export interface InviteInput {
  visitorName: string;
  visitorPhone: string;
  validFrom: Date;
  validTo: Date;
  purpose: string;
}

@Injectable()
export class VisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: VisitLifecycleService,
    private readonly storage: StorageService,
  ) {}

  async invite(user: AuthUser, input: InviteInput): Promise<Visit> {
    if (!user.siteId) throw new ApiException(422, 'VALIDATION_FAILED', 'Aapke account par site set nahi hai.');
    const phone = requirePhone(input.visitorPhone);
    if (input.validTo <= input.validFrom || input.validTo <= new Date()) {
      throw new ApiException(422, 'VALIDATION_FAILED', 'Khatam hone ka time shuru hone ke baad ka hona chahiye.');
    }
    if (input.validTo.getTime() - input.validFrom.getTime() > MAX_WINDOW_MS) {
      throw new ApiException(422, 'VALIDATION_FAILED', 'Ek pass 24 ghante se zyada ka nahi ho sakta.');
    }

    // Purana visitor ho to uska naam nahi badalte, visitor khud form mein theek karega.
    const visitor = await this.prisma.visitor.upsert({
      where: { phone },
      update: {},
      create: { phone, name: input.visitorName },
    });
    const host = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { site: true } });
    const { token, hash } = newInviteToken();

    return this.lifecycle.create({
      data: {
        visitorId: visitor.id,
        hostId: user.id,
        siteId: user.siteId,
        type: 'PRE',
        purpose: input.purpose,
        status: 'INVITED',
        validFrom: input.validFrom,
        validTo: input.validTo,
        inviteTokenHash: hash,
      },
      actorId: user.id,
      notify: [
        {
          channel: 'SMS',
          template: 'INVITE_LINK',
          recipient: phone,
          vars: { hostName: host.name, siteName: host.site?.name ?? '', link: inviteLink(token) },
        },
      ],
    });
  }

  async list(user: AuthUser, q: { scope: 'mine' | 'site'; date?: string; status?: VisitStatus }) {
    const where: Prisma.VisitWhereInput = {};
    if (q.scope === 'site') {
      if (!SITE_STAFF.includes(user.role)) throw forbidden();
      where.siteId = user.siteId ?? undefined;
    } else {
      where.OR = [{ hostId: user.id }, { host: { delegateId: user.id } }];
    }
    if (q.status) where.status = q.status;
    if (q.date) {
      const { start, end } = istDayRange(q.date);
      where.validFrom = { lt: end };
      where.validTo = { gt: start };
    }
    const rows = await this.prisma.visit.findMany({
      where,
      include: VISIT_INCLUDE,
      orderBy: { validFrom: 'desc' },
      take: 200,
    });
    return rows.map((v) => this.toSummary(v));
  }

  async get(user: AuthUser, id: string) {
    const visit = await this.load(id);
    if (!this.isHostOrDelegate(user, visit) && !this.isSiteStaff(user, visit, SITE_STAFF)) throw forbidden();
    return { ...this.toSummary(visit), purpose: visit.purpose, hostId: visit.hostId, type: visit.type };
  }

  async cancel(user: AuthUser, id: string) {
    const visit = await this.load(id);
    if (!this.isHostOrDelegate(user, visit) && !this.isSiteStaff(user, visit, DESK_STAFF)) throw forbidden();
    const updated = await this.lifecycle.apply({
      visitId: id,
      action: 'CANCEL',
      actorId: user.id,
      deviceId: user.deviceId,
    });
    return { id: updated.id, status: updated.status };
  }

  /** Naya link: purana band ho jata hai. */
  async resendInvite(user: AuthUser, id: string): Promise<void> {
    const visit = await this.load(id);
    if (!this.isHostOrDelegate(user, visit) && !this.isSiteStaff(user, visit, DESK_STAFF)) throw forbidden();
    if (visit.status !== 'INVITED' && visit.status !== 'APPROVED') {
      throw new ApiException(409, 'INVALID_TRANSITION', 'Is visit ka link dobara nahi bheja ja sakta.', {
        status: visit.status,
      });
    }
    const { token, hash } = newInviteToken();
    const link = inviteLink(token);
    await this.prisma.$transaction([
      this.prisma.visit.update({ where: { id }, data: { inviteTokenHash: hash } }),
      this.prisma.visitEvent.create({ data: { visitId: id, type: 'INVITE_RESENT', actorId: user.id } }),
      this.prisma.outbox.create({
        data:
          visit.status === 'INVITED'
            ? {
                visitId: id,
                channel: 'SMS',
                template: 'INVITE_LINK',
                recipient: visit.visitor.phone,
                vars: { hostName: visit.host.name, siteName: visit.site.name, link },
              }
            : {
                visitId: id,
                channel: 'SMS',
                template: 'PASS_READY',
                recipient: visit.visitor.phone,
                vars: { link },
              },
      }),
    ]);
  }

  async load(id: string): Promise<VisitWithPeople> {
    const visit = await this.prisma.visit.findUnique({ where: { id }, include: VISIT_INCLUDE });
    if (!visit) throw new ApiException(404, 'NOT_FOUND', 'Visit nahi mila.');
    return visit;
  }

  isHostOrDelegate(user: AuthUser, visit: VisitWithPeople): boolean {
    return visit.hostId === user.id || visit.host.delegateId === user.id;
  }

  isSiteStaff(user: AuthUser, visit: Visit, roles: string[]): boolean {
    return roles.includes(user.role) && user.siteId === visit.siteId;
  }

  toSummary(v: VisitWithPeople): VisitSummary {
    return {
      id: v.id,
      code: v.code,
      status: v.status,
      visitorName: v.visitor.name,
      company: v.visitor.company,
      photoUrl: v.visitor.photoKey ? this.storage.photoUrl(v.visitor.photoKey) : null,
      hostName: v.host.name,
      validFrom: v.validFrom.toISOString(),
      validTo: v.validTo.toISOString(),
      checkedInAt: v.checkedInAt?.toISOString() ?? null,
    };
  }
}
