import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PassService } from '../src/passes/pass.service';
import { seedBusiness, seedSite, seedUser, seedVisit, seedVisitor } from './factories';
import { createTestApp, resetData, TestContext, tokenFor } from './setup';

describe('tenancy: ek business ka data doosre ko nahi', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(() => resetData(ctx));
  afterAll(() => ctx.app.close());

  /** Do businesses, har ek ka premises, admin aur guard. */
  async function twoBusinesses() {
    const make = async () => {
      const business = await seedBusiness(ctx.prisma);
      const { site, gate } = await seedSite(ctx.prisma, 'Main', business.id);
      const admin = await seedUser(ctx.prisma, site.id, 'admin');
      const guard = await seedUser(ctx.prisma, site.id, 'guard');
      const host = await seedUser(ctx.prisma, site.id, 'employee');
      return {
        business,
        site,
        gate,
        admin,
        guard,
        host,
        adminToken: await tokenFor(ctx, admin.id),
        guardToken: await tokenFor(ctx, guard.id),
      };
    };
    return { a: await make(), b: await make() };
  }

  describe('data rules', () => {
    it('same phone can be a user in two businesses, not twice in one', async () => {
      const { a, b } = await twoBusinesses();
      await seedUser(ctx.prisma, a.site.id, 'employee', { phone: '+919811100000' });
      await seedUser(ctx.prisma, b.site.id, 'employee', { phone: '+919811100000' });
      await expect(seedUser(ctx.prisma, a.site.id, 'employee', { phone: '+919811100000' })).rejects.toThrow();
    });

    it('same visitor phone is a separate record per business', async () => {
      const { a, b } = await twoBusinesses();
      await seedVisitor(ctx.prisma, a.business.id, { phone: '+919822200000' });
      await seedVisitor(ctx.prisma, b.business.id, { phone: '+919822200000' });
      await expect(seedVisitor(ctx.prisma, a.business.id, { phone: '+919822200000' })).rejects.toThrow();
    });

    it('audit_logs rejects update and delete', async () => {
      const row = await ctx.prisma.auditLog.create({ data: { entity: 'user', entityId: 'x', action: 'create' } });
      await expect(ctx.prisma.$executeRaw`UPDATE audit_logs SET action = 'y' WHERE id = ${row.id}::uuid`).rejects.toThrow(/append-only/);
      await expect(ctx.prisma.$executeRaw`DELETE FROM audit_logs WHERE id = ${row.id}::uuid`).rejects.toThrow(/append-only/);
    });
  });

  describe('admin', () => {
    it('lists only own premises, gates and users', async () => {
      const { a, b } = await twoBusinesses();
      for (const path of ['/admin/premises', '/admin/gates', '/admin/users']) {
        const res = await http().get(path).set(auth(a.adminToken)).expect(200);
        const ids = res.body.map((r: { id: string }) => r.id);
        expect(ids).not.toContain(b.site.id);
        expect(ids).not.toContain(b.gate.id);
        expect(ids).not.toContain(b.admin.id);
      }
    });

    it('cannot change other business premises, gate or user', async () => {
      const { a, b } = await twoBusinesses();
      await http().patch(`/admin/premises/${b.site.id}`).set(auth(a.adminToken)).send({ name: 'Hacked' }).expect(404);
      await http().patch(`/admin/gates/${b.gate.id}`).set(auth(a.adminToken)).send({ name: 'Hacked' }).expect(404);
      await http().patch(`/admin/users/${b.guard.id}`).set(auth(a.adminToken)).send({ isActive: false }).expect(404);
      expect((await ctx.prisma.premises.findUniqueOrThrow({ where: { id: b.site.id } })).name).toBe('Main');
    });

    it('cannot put own user or gate into other business premises', async () => {
      const { a, b } = await twoBusinesses();
      await http()
        .post('/admin/users')
        .set(auth(a.adminToken))
        .send({ name: 'X', phone: '9811133333', role: 'guard', premisesIds: [b.site.id] })
        .expect(422);
      await http().post('/admin/gates').set(auth(a.adminToken)).send({ premisesId: b.site.id, name: 'G' }).expect(422);
    });

    it('new premises gets code, slug and settings', async () => {
      const { a } = await twoBusinesses();
      const res = await http().post('/admin/premises').set(auth(a.adminToken)).send({ name: 'Plant 2 Surat' }).expect(201);
      expect(res.body.code).toMatch(/^[A-Z2-9]{6}$/);
      expect(res.body.webSlug).toBe('plant-2-surat');
      expect(res.body.isDefault).toBe(false);
      expect(await ctx.prisma.premisesSetting.count({ where: { premisesId: res.body.id } })).toBe(1);
    });
  });

  describe('visits and gate', () => {
    it('visit list and detail never show other business visits', async () => {
      const { a, b } = await twoBusinesses();
      const otherVisit = await seedVisit(ctx.prisma, { premisesId: b.site.id, hostId: b.host.id });
      const list = await http().get('/visits?scope=site').set(auth(a.guardToken)).expect(200);
      expect(list.body.map((v: { id: string }) => v.id)).not.toContain(otherVisit.id);
      await http().get(`/visits/${otherVisit.id}`).set(auth(a.guardToken)).expect(403);
    });

    it('QR of other business does not work at this gate', async () => {
      const { a, b } = await twoBusinesses();
      const visit = await seedVisit(ctx.prisma, { premisesId: b.site.id, hostId: b.host.id });
      const qr = ctx.app.get(PassService).sign({
        visitId: visit.id,
        premisesId: b.site.id,
        validFrom: visit.validFrom,
        validTo: visit.validTo,
      });
      const res = await http()
        .post('/gate/scan')
        .set(auth(a.guardToken))
        .send({ qr, gateId: a.gate.id, mode: 'IN', clientEventId: randomUUID() });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe('WRONG_SITE');
    });

    it('guard cannot use other business gate or check in its visit', async () => {
      const { a, b } = await twoBusinesses();
      const visit = await seedVisit(ctx.prisma, { premisesId: b.site.id, hostId: b.host.id });
      await http()
        .post(`/visits/${visit.id}/check-in`)
        .set(auth(a.guardToken))
        .send({ gateId: b.gate.id, clientEventId: randomUUID() })
        .expect(403);
      await http()
        .post(`/visits/${visit.id}/check-in`)
        .set(auth(a.guardToken))
        .send({ gateId: a.gate.id, clientEventId: randomUUID() })
        .expect(403);
    });

    it('event id of other business does not reveal its visit', async () => {
      const { a, b } = await twoBusinesses();
      const visit = await seedVisit(ctx.prisma, { premisesId: b.site.id, hostId: b.host.id, status: 'CHECKED_IN' });
      const eventId = randomUUID();
      await ctx.prisma.visitEvent.create({
        data: { visitId: visit.id, businessId: b.business.id, type: 'CHECK_IN', clientEventId: eventId },
      });
      const res = await http()
        .post('/gate/scan')
        .set(auth(a.guardToken))
        .send({ qr: 'garbage', gateId: a.gate.id, mode: 'IN', clientEventId: eventId });
      expect(res.status).toBe(422);
      expect(JSON.stringify(res.body)).not.toContain(visit.id);
    });

    it('dashboard shows only own premises', async () => {
      const { a, b } = await twoBusinesses();
      await seedVisit(ctx.prisma, { premisesId: b.site.id, hostId: b.host.id, status: 'CHECKED_IN' });
      const res = await http().get('/dashboard/live').set(auth(a.guardToken)).expect(200);
      expect(res.body.inside).toHaveLength(0);
    });

    it('host search and walk-in lookup stay inside the business', async () => {
      const { a, b } = await twoBusinesses();
      await ctx.prisma.user.update({ where: { id: b.host.id }, data: { name: 'Zed Other' } });
      const hosts = await http().get('/users/hosts?q=zed').set(auth(a.guardToken)).expect(200);
      expect(hosts.body).toEqual([]);
      await seedVisitor(ctx.prisma, b.business.id, { phone: '+919833300000', name: 'Secret' });
      const lookup = await http().get('/gate/visitors/lookup?phone=9833300000').set(auth(a.guardToken)).expect(200);
      expect(lookup.body).toEqual({ found: false });
    });

    it('devices list stays inside the business', async () => {
      const { a, b } = await twoBusinesses();
      const res = await http().get('/admin/devices').set(auth(a.adminToken)).expect(200);
      const userIds = res.body.map((d: { user: { id: string } }) => d.user.id);
      expect(userIds).not.toContain(b.guard.id);
      expect(userIds).not.toContain(b.admin.id);
    });
  });

  describe('session', () => {
    it('inactive business locks its users out', async () => {
      const { a } = await twoBusinesses();
      await ctx.prisma.business.update({ where: { id: a.business.id }, data: { isActive: false } });
      await http().get('/me').set(auth(a.guardToken)).expect(401);
    });

    it('/me shows business and premises', async () => {
      const { a } = await twoBusinesses();
      const res = await http().get('/me').set(auth(a.guardToken)).expect(200);
      expect(res.body.business).toEqual({ id: a.business.id, name: a.business.name, slug: a.business.slug });
      expect(res.body.premises).toEqual([{ id: a.site.id, name: 'Main', isDefault: true }]);
      expect(res.body.activePremisesId).toBe(a.site.id);
    });
  });
});
