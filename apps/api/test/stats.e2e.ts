import request from 'supertest';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { seedSite, seedUser, seedVisit } from './factories';
import { createTestApp, inTenant, resetData, TestContext, tokenFor } from './setup';

describe('dashboard stats', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(() => resetData(ctx));
  afterAll(() => ctx.app.close());

  // 20 Nov 2026, 12:00 in India.
  const now = new Date('2026-11-20T06:30:00.000Z');
  const at = (iso: string) => new Date(iso);

  async function seed() {
    const { site } = await seedSite(ctx.prisma, 'Head Office');
    const other = await seedSite(ctx.prisma, 'Other');
    const anita = await seedUser(ctx.prisma, site.id, 'employee', { name: 'Anita Singh' });
    const rakesh = await seedUser(ctx.prisma, site.id, 'employee', { name: 'Rakesh Patel' });
    const on = { premisesId: site.id };

    async function visit(
      over: Parameters<typeof seedVisit>[1],
      data: { checkedInAt?: Date; createdAt: Date; type?: 'PRE' | 'WALKIN' | 'SELF'; hostId?: null },
    ) {
      const v = await seedVisit(ctx.prisma, { ...on, ...over });
      return ctx.prisma.visit.update({ where: { id: v.id }, data });
    }

    const inside = await visit({ hostId: anita.id, status: 'CHECKED_IN' }, { checkedInAt: at('2026-11-20T05:30:00Z'), createdAt: at('2026-11-20T04:30:00Z') });
    await visit({ hostId: anita.id, status: 'CHECKED_OUT' }, { checkedInAt: at('2026-11-05T06:00:00Z'), createdAt: at('2026-11-05T05:00:00Z') });
    await visit({ hostId: rakesh.id, status: 'CHECKED_OUT' }, { checkedInAt: at('2026-03-10T06:00:00Z'), createdAt: at('2026-03-10T05:00:00Z') });
    // 1 Jan 2026, 01:30 in India: January, though it is still 31 Dec in UTC.
    await visit({ hostId: rakesh.id, status: 'CHECKED_OUT' }, { checkedInAt: at('2025-12-31T20:00:00Z'), createdAt: at('2025-12-31T19:00:00Z') });
    const waiting = await visit({ status: 'PENDING_APPROVAL' }, { createdAt: at('2026-11-20T06:20:00Z'), type: 'SELF', hostId: null });
    await visit({ status: 'REJECTED' }, { createdAt: at('2026-11-19T06:00:00Z'), type: 'WALKIN' });
    // Another premises is never counted.
    await seedVisit(ctx.prisma, { premisesId: other.site.id, status: 'CHECKED_IN' });
    return { site, inside, waiting };
  }

  it('counts visits, invites, walk-ins and rejections by India day, month and total', async () => {
    const { site, inside, waiting } = await seed();
    const stats = await inTenant(ctx, ctx.app.get(DashboardService)).stats(site.id, 'month', now);

    expect(stats.visits).toEqual({ today: 1, month: 2, total: 4 });
    expect(stats.invites).toEqual({ today: 1, month: 2, total: 4 });
    expect(stats.walkIns).toEqual({ today: 1, month: 2, total: 2 });
    expect(stats.rejected).toEqual({ today: 0, month: 1, total: 1 });
    expect(stats.totalVisitors).toBe(4);
    expect(stats.insideNow).toBe(1);
    expect(stats.waitingNow).toBe(1);
    expect(stats.year).toBe(2026);
    expect(stats.monthWise).toEqual([1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 2, 0]);
    expect(stats.hostWise).toEqual([{ name: 'Anita Singh', count: 2 }]);
    expect(stats.todayVisits.map((v) => v.id)).toEqual([inside.id, waiting.id]);
    expect(stats.todayVisits[1].hostName).toBe('Security gate');
  });

  it('host-wise visits follow the chosen period', async () => {
    const { site } = await seed();
    const service = inTenant(ctx, ctx.app.get(DashboardService));
    expect((await service.stats(site.id, 'today', now)).hostWise).toEqual([{ name: 'Anita Singh', count: 1 }]);
    expect((await service.stats(site.id, 'year', now)).hostWise).toEqual([
      { name: 'Anita Singh', count: 2 },
      { name: 'Rakesh Patel', count: 2 },
    ]);
  });

  it('desk roles can open the stats; employees and guards cannot', async () => {
    const { site } = await seedSite(ctx.prisma);
    const admin = await seedUser(ctx.prisma, site.id, 'admin');
    const res = await http().get('/dashboard/stats?period=year').set('Authorization', `Bearer ${await tokenFor(ctx, admin.id)}`).expect(200);
    expect(res.body.period).toBe('year');
    expect(res.body.monthWise).toHaveLength(12);
    const odd = await http().get('/dashboard/stats?period=nonsense').set('Authorization', `Bearer ${await tokenFor(ctx, admin.id)}`).expect(200);
    expect(odd.body.period).toBe('month');

    for (const role of ['employee', 'guard'] as const) {
      const user = await seedUser(ctx.prisma, site.id, role);
      await http().get('/dashboard/stats').set('Authorization', `Bearer ${await tokenFor(ctx, user.id)}`).expect(403);
    }
  });
});
