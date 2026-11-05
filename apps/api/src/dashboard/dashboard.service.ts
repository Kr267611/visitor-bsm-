import { Injectable } from '@nestjs/common';
import type { LiveDashboard } from '@visitor/shared';
import { istDayRange } from '../common/time';
import { PrismaService } from '../prisma/prisma.service';
import { VISIT_INCLUDE, VisitsService } from '../visits/visits.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly visits: VisitsService,
  ) {}

  async live(siteId: string, now: Date = new Date()): Promise<LiveDashboard> {
    const { start, end } = istDayRange(undefined, now);
    const rows = await this.prisma.visit.findMany({
      where: {
        siteId,
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
