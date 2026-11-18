import { Inject, Injectable } from '@nestjs/common';
import type { LiveDashboard } from '@visitor/shared';
import { istDayRange } from '../common/time';
import { TENANT_PRISMA, TenantPrismaClient } from '../tenancy/tenant-prisma';
import { VISIT_INCLUDE, VisitsService } from '../visits/visits.service';

@Injectable()
export class DashboardService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrismaClient,
    private readonly visits: VisitsService,
  ) {}

  async live(premisesId: string, now: Date = new Date()): Promise<LiveDashboard> {
    const { start, end } = istDayRange(undefined, now);
    const rows = await this.prisma.visit.findMany({
      where: {
        premisesId,
        OR: [
          { status: 'CHECKED_IN' },
          { status: 'PENDING_APPROVAL' },
          { status: { in: ['INVITED', 'APPROVED'] }, validFrom: { lt: end }, validTo: { gt: start } },
        ],
      },
      include: VISIT_INCLUDE,
      orderBy: { validFrom: 'asc' },
    });

    const data: LiveDashboard = { inside: [], expected: [], pending: [], needsCall: [] };
    for (const row of rows) {
      const summary = this.visits.toSummary(row);
      if (row.status === 'CHECKED_IN') data.inside.push(summary);
      else if (row.status !== 'PENDING_APPROVAL') data.expected.push(summary);
      else if (row.receptionCallRequestedAt) data.needsCall.push({ ...summary, hostPhone: row.host.phone });
      else data.pending.push(summary);
    }
    return data;
  }
}
