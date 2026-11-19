import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { FEATURE_RESTRICTED_MESSAGE } from '../src/auth/permissions';
import { monthStartIst } from '../src/plans/plan-limits.service';
import { seedSite, seedUser, seedVisit } from './factories';
import { createTestApp, resetData, TestContext, tokenFor } from './setup';

describe('permissions: role ∩ plan', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(() => resetData(ctx));
  afterAll(() => ctx.app.close());

  /** Moves the test business onto a new plan. */
  async function onPlan(
    businessId: string,
    plan: { features?: string[]; premisesLimit?: number; memberLimit?: number; visitLimit?: number },
  ) {
    const created = await ctx.prisma.plan.create({
      data: { code: `p-${randomUUID().slice(0, 8)}`, name: 'Test plan', features: plan.features ?? [], ...plan },
    });
    await ctx.prisma.business.update({ where: { id: businessId }, data: { planId: created.id } });
  }

  async function setup() {
    const { site, gate, business } = await seedSite(ctx.prisma);
    const admin = await seedUser(ctx.prisma, site.id, 'admin');
    const guard = await seedUser(ctx.prisma, site.id, 'guard');
    return {
      site,
      gate,
      business,
      admin,
      adminToken: await tokenFor(ctx, admin.id),
      guardToken: await tokenFor(ctx, guard.id),
    };
  }

  const invite = (token: string) =>
    http()
      .post('/visits')
      .set(auth(token))
      .send({
        visitorName: 'Rahul',
        visitorPhone: '9876543210',
        validFrom: new Date(Date.now() + 60_000).toISOString(),
        validTo: new Date(Date.now() + 3_600_000).toISOString(),
        purpose: 'Meeting',
      });

  describe('plan features', () => {
    it('module not in plan gives 403 FEATURE_RESTRICTED with the message', async () => {
      const { business, guardToken, adminToken } = await setup();
      await onPlan(business.id, { features: ['visitor_desk'] });
      const res = await http().get('/dashboard/live').set(auth(guardToken)).expect(403);
      expect(res.body).toEqual({ error: 'FEATURE_RESTRICTED', message: FEATURE_RESTRICTED_MESSAGE, feature: 'dashboard' });
      expect((await invite(adminToken)).body.error).toBe('FEATURE_RESTRICTED');
    });

    it('module in plan works, role still checked', async () => {
      const { business, guardToken, adminToken } = await setup();
      await onPlan(business.id, { features: ['dashboard', 'invites'] });
      await http().get('/dashboard/live').set(auth(guardToken)).expect(200);
      expect((await invite(adminToken)).status).toBe(201);
      // A guard's role cannot invite, even when the plan includes invites.
      expect((await invite(guardToken)).body.error).toBe('FORBIDDEN');
    });

    it('walk-in needs visitor_desk', async () => {
      const { business, guardToken } = await setup();
      await onPlan(business.id, { features: ['dashboard'] });
      const res = await http().post('/gate/walk-ins/otp').set(auth(guardToken)).send({ phone: '9876543210' }).expect(403);
      expect(res.body.feature).toBe('visitor_desk');
    });

    it('/me lists the plan features for the app menus', async () => {
      const { business, guardToken } = await setup();
      await onPlan(business.id, { features: ['dashboard', 'reports'] });
      const me = await http().get('/me').set(auth(guardToken)).expect(200);
      expect(me.body.features).toEqual(['dashboard', 'reports']);
    });
  });

  describe('plan limits', () => {
    it('premises limit stops a new premises', async () => {
      const { business, adminToken } = await setup();
      await onPlan(business.id, { premisesLimit: 1 });
      const res = await http().post('/admin/premises').set(auth(adminToken)).send({ name: 'Plant 2' }).expect(422);
      expect(res.body).toMatchObject({ error: 'PLAN_LIMIT', kind: 'premises', limit: 1 });
    });

    it('member limit stops a new user and turning one back on', async () => {
      const { site, business, adminToken } = await setup();
      const off = await seedUser(ctx.prisma, site.id, 'guard', { isActive: false });
      await onPlan(business.id, { memberLimit: 2 });
      const res = await http()
        .post('/admin/users')
        .set(auth(adminToken))
        .send({ name: 'New', phone: '9811122222', role: 'guard', premisesIds: [site.id], password: 'new123' })
        .expect(422);
      expect(res.body.kind).toBe('members');
      await http().patch(`/admin/users/${off.id}`).set(auth(adminToken)).send({ isActive: true }).expect(422);
      // Renaming does not count against the limit.
      await http().patch(`/admin/users/${off.id}`).set(auth(adminToken)).send({ name: 'Renamed' }).expect(200);
    });

    it('monthly visit limit stops invites and walk-ins', async () => {
      const { site, gate, business, admin, adminToken, guardToken } = await setup();
      await seedVisit(ctx.prisma, { premisesId: site.id });
      await onPlan(business.id, { features: ['invites', 'visitor_desk'], visitLimit: 1 });
      const res = await invite(adminToken);
      expect(res.status).toBe(422);
      expect(res.body.kind).toBe('visits');
      const walkIn = await http()
        .post('/gate/walk-ins')
        .set(auth(guardToken))
        .send({
          gateId: gate.id,
          hostId: admin.id,
          phone: '9876543210',
          otp: '123456',
          name: 'R',
          purpose: 'Meeting',
          consent: true,
          clientEventId: randomUUID(),
        });
      expect(walkIn.body.error).toBe('PLAN_LIMIT');
    });

    it('no limit on the plan means unlimited', async () => {
      const { adminToken } = await setup();
      await http().post('/admin/premises').set(auth(adminToken)).send({ name: 'Plant 2' }).expect(201);
    });

    it('month starts at midnight IST', () => {
      expect(monthStartIst(new Date('2026-11-30T20:00:00Z')).toISOString()).toBe('2026-11-30T18:30:00.000Z');
      expect(monthStartIst(new Date('2026-11-15T10:00:00Z')).toISOString()).toBe('2026-10-31T18:30:00.000Z');
    });
  });

  describe('super admin', () => {
    async function superAdmin() {
      const user = await ctx.prisma.user.create({
        data: { name: 'Platform', phone: '+919800099999', role: 'super_admin', businessId: null },
      });
      return tokenFor(ctx, user.id);
    }

    it('cannot open tenant routes', async () => {
      await setup();
      const token = await superAdmin();
      for (const path of ['/admin/users', '/admin/premises', '/gates', '/visits', '/dashboard/live', '/users/hosts']) {
        const res = await http().get(path).set(auth(token));
        expect([path, res.status]).toEqual([path, 403]);
      }
    });

    it('can open own profile', async () => {
      const token = await superAdmin();
      const me = await http().get('/me').set(auth(token)).expect(200);
      expect(me.body).toMatchObject({ role: 'super_admin', business: null, premises: [], features: [] });
    });
  });
});
