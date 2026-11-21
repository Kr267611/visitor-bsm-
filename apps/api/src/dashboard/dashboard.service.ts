import { Inject, Injectable } from '@nestjs/common';
import type { DashboardStats, LiveDashboard, StatCount, StatsPeriod } from '@visitor/shared';
import { RECEPTION_DESK } from '../common/records';
import { istDayRange, istYear } from '../common/time';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** India calendar month (1-12) of a moment. */
function istMonth(d: Date): number {
  return new Date(d.getTime() + IST_OFFSET_MS).getUTCMonth() + 1;
}

const pad = (n: number) => String(n).padStart(2, '0');
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
      else if (row.receptionCallRequestedAt) data.needsCall.push({ ...summary, hostPhone: row.host?.phone ?? null });
      else data.pending.push(summary);
    }
    return data;
  }

  /** Counts and charts for one premises. Days, months and years are India time. */
  async stats(premisesId: string, period: StatsPeriod = 'month', now: Date = new Date()): Promise<DashboardStats> {
    const today = istDayRange(undefined, now);
    const year = istYear(now);
    const month = istMonth(now);
    const monthStart = istDayRange(`${year}-${pad(month)}-01`).start;
    const yearStart = istDayRange(`${year}-01-01`).start;
    const nextYear = istDayRange(`${year + 1}-01-01`).start;
    const periodStart = period === 'today' ? today.start : period === 'month' ? monthStart : yearStart;

    const visit = this.prisma.visit;
    const count = async (where: object, field: 'checkedInAt' | 'createdAt'): Promise<StatCount> => {
      const [t, m, all] = await Promise.all([
        visit.count({ where: { premisesId, ...where, [field]: { gte: today.start, lt: today.end } } }),
        visit.count({ where: { premisesId, ...where, [field]: { gte: monthStart, lt: today.end } } }),
        visit.count({ where: { premisesId, ...where, ...(field === 'checkedInAt' && { checkedInAt: { not: null } }) } }),
      ]);
      return { today: t, month: m, total: all };
    };

    const [visits, invites, walkIns, rejected, people, insideNow, waitingNow, byHost, arrivals, todayRows] = await Promise.all([
      count({}, 'checkedInAt'),
      count({ type: 'PRE' }, 'createdAt'),
      count({ type: { in: ['WALKIN', 'SELF'] } }, 'createdAt'),
      count({ status: 'REJECTED' }, 'createdAt'),
      visit.groupBy({ by: ['visitorId'], where: { premisesId, checkedInAt: { not: null } } }),
      visit.count({ where: { premisesId, status: 'CHECKED_IN' } }),
      visit.count({ where: { premisesId, status: 'PENDING_APPROVAL' } }),
      visit.groupBy({
        by: ['hostId'],
        where: { premisesId, checkedInAt: { gte: periodStart, lt: today.end } },
        _count: { _all: true },
      }),
      visit.findMany({
        where: { premisesId, checkedInAt: { gte: yearStart, lt: nextYear } },
        select: { checkedInAt: true },
      }),
      visit.findMany({
        where: {
          premisesId,
          OR: [
            { checkedInAt: { gte: today.start, lt: today.end } },
            { createdAt: { gte: today.start, lt: today.end } },
            { status: { in: ['INVITED', 'APPROVED'] }, validFrom: { lt: today.end }, validTo: { gt: today.start } },
          ],
        },
        include: VISIT_INCLUDE,
        orderBy: [{ checkedInAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        take: 100,
      }),
    ]);

    const hostIds = byHost.map((h) => h.hostId).filter((id): id is string => !!id);
    const hosts = hostIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: hostIds } }, select: { id: true, name: true } })
      : [];
    const hostName = new Map(hosts.map((h) => [h.id, h.name]));
    const hostWise = byHost
      .map((h) => ({ name: h.hostId ? (hostName.get(h.hostId) ?? 'Former member') : RECEPTION_DESK, count: h._count._all }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 30);

    const monthWise = Array<number>(12).fill(0);
    for (const row of arrivals) if (row.checkedInAt) monthWise[istMonth(row.checkedInAt) - 1] += 1;

    return {
      visits,
      invites,
      walkIns,
      rejected,
      totalVisitors: people.length,
      insideNow,
      waitingNow,
      hostWise,
      period,
      monthWise,
      year,
      todayVisits: todayRows.map((row) => this.visits.toSummary(row)),
    };
  }
}
