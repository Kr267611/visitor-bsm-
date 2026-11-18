import { Global, Injectable, Module } from '@nestjs/common';
import { ApiException } from '../common/api-exception';
import { PrismaService } from '../prisma/prisma.service';

export type LimitKind = 'premises' | 'members' | 'visits';

const LABEL: Record<LimitKind, string> = {
  premises: 'premises',
  members: 'active members',
  visits: 'is mahine ke visits',
};

/** IST (UTC+5:30) mein is mahine ki shuruaat. */
export function monthStartIst(now = new Date()): Date {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 330 * 60_000);
}

/** Plan ki limit (null = unlimited) se zyada naya premises/member/visit na bane. */
@Injectable()
export class PlanLimits {
  constructor(private readonly prisma: PrismaService) {}

  async assert(businessId: string, kind: LimitKind, adding = 1): Promise<void> {
    const { plan } = await this.prisma.business.findUniqueOrThrow({ where: { id: businessId }, include: { plan: true } });
    const limit = { premises: plan.premisesLimit, members: plan.memberLimit, visits: plan.visitLimit }[kind];
    if (limit == null) return;
    const used = await this.count(businessId, kind);
    if (used + adding > limit) {
      throw new ApiException(422, 'PLAN_LIMIT', `Aapke plan mein ${LABEL[kind]} ki limit (${limit}) poori ho gayi. Plan upgrade karein.`, {
        kind,
        limit,
      });
    }
  }

  private count(businessId: string, kind: LimitKind): Promise<number> {
    switch (kind) {
      case 'premises':
        return this.prisma.premises.count({ where: { businessId } });
      case 'members':
        return this.prisma.user.count({ where: { businessId, isActive: true } });
      case 'visits':
        return this.prisma.visit.count({ where: { businessId, createdAt: { gte: monthStartIst() } } });
    }
  }
}

@Global()
@Module({ providers: [PlanLimits], exports: [PlanLimits] })
export class PlansModule {}
