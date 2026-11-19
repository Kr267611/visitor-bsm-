import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ApprovalTimerProcessor } from '../src/approvals/approval-timer.processor';
import { PassService } from '../src/passes/pass.service';
import { ExpiryJob } from '../src/visits/expiry.job';
import { currentContext, runAsSystem, runInTenant, tenantId } from '../src/tenancy/request-context';
import { TENANT_PRISMA, TenantContextMissingError, TenantPrismaClient } from '../src/tenancy/tenant-prisma';
import { seedBusiness, seedSite, seedUser, seedVisit, seedVisitor } from './factories';
import { createTestApp, resetData, TestContext, tokenFor } from './setup';

describe('tenancy: one business never sees another', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(() => resetData(ctx));
  afterAll(() => ctx.app.close());

  /** Two businesses, each with a premises, an admin and a guard. */
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
        .send({ name: 'X', phone: '9811133333', role: 'guard', premisesIds: [b.site.id], password: 'xx1234' })
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
      // Another business's visit simply does not exist: not even its existence is revealed.
      await http().get(`/visits/${otherVisit.id}`).set(auth(a.guardToken)).expect(404);
      await http().post(`/visits/${otherVisit.id}/cancel`).set(auth(a.adminToken)).expect(404);
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
        .expect(422);
      await http()
        .post(`/visits/${visit.id}/check-in`)
        .set(auth(a.guardToken))
        .send({ gateId: a.gate.id, clientEventId: randomUUID() })
        .expect(422);
      expect((await ctx.prisma.visit.findUniqueOrThrow({ where: { id: visit.id } })).status).toBe('APPROVED');
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

  describe('scoped database client', () => {
    const db = () => ctx.app.get<TenantPrismaClient>(TENANT_PRISMA);

    it('reads only own business rows', async () => {
      const { a, b } = await twoBusinesses();
      const gates = await runInTenant(a.business.id, () => db().gate.findMany());
      expect(gates.map((g) => g.id)).toEqual([a.gate.id]);
      expect(await runInTenant(a.business.id, () => db().user.count())).toBe(3);
      expect(await runInTenant(a.business.id, () => db().gate.findMany({ where: { OR: [{ id: b.gate.id }, { name: a.gate.name }] } }))).toHaveLength(1);
    });

    it('other business id: findUnique null, update and delete not found', async () => {
      const { a, b } = await twoBusinesses();
      await runInTenant(a.business.id, async () => {
        expect(await db().gate.findUnique({ where: { id: b.gate.id } })).toBeNull();
        await expect(db().gate.update({ where: { id: b.gate.id }, data: { name: 'X' } })).rejects.toThrow();
        await expect(db().gate.delete({ where: { id: b.gate.id } })).rejects.toThrow();
        expect((await db().gate.updateMany({ data: { name: 'Mine' } })).count).toBe(1);
      });
      expect((await ctx.prisma.gate.findUniqueOrThrow({ where: { id: b.gate.id } })).name).not.toBe('Mine');
    });

    it('create fills businessId, refuses another business', async () => {
      const { a, b } = await twoBusinesses();
      const dept = await runInTenant(a.business.id, () => db().department.create({ data: { name: 'Finance', businessId: tenantId() } }));
      expect(dept.businessId).toBe(a.business.id);
      const many = await runInTenant(a.business.id, () =>
        // Types require businessId; if code forgets it at runtime, the client fills it in.
        db().department.createManyAndReturn({ data: [{ name: 'HR' }, { name: 'IT' }] as never }),
      );
      expect(many.every((d) => d.businessId === a.business.id)).toBe(true);
      await expect(
        runInTenant(a.business.id, () => db().department.create({ data: { name: 'X', businessId: b.business.id } })),
      ).rejects.toThrow(/another business/);
      await expect(
        runInTenant(a.business.id, () => db().gate.update({ where: { id: a.gate.id }, data: { businessId: b.business.id } })),
      ).rejects.toThrow(/changing the business/);
    });

    it('create with relation connect also gets the business', async () => {
      const { a } = await twoBusinesses();
      const gate = await runInTenant(a.business.id, () =>
        db().gate.create({ data: { name: 'Side', premises: { connect: { id: a.site.id } } } as never }),
      );
      expect(gate.businessId).toBe(a.business.id);
    });

    it('upsert cannot reach another business row', async () => {
      const { a, b } = await twoBusinesses();
      const visitor = await seedVisitor(ctx.prisma, b.business.id, { phone: '+919844400000', name: 'B' });
      const row = await runInTenant(a.business.id, () =>
        db().visitor.upsert({
          where: { businessId_phone: { businessId: a.business.id, phone: '+919844400000' } },
          create: { phone: '+919844400000', name: 'A', businessId: tenantId() },
          update: { name: 'A2' },
        }),
      );
      expect(row.businessId).toBe(a.business.id);
      expect(row.id).not.toBe(visitor.id);
      expect((await ctx.prisma.visitor.findUniqueOrThrow({ where: { id: visitor.id } })).name).toBe('B');
    });

    it('throws without context, system sees everything', async () => {
      await twoBusinesses();
      expect(() => tenantId()).toThrow(/Tenant context missing/);
      await expect(db().gate.findMany()).rejects.toThrow(TenantContextMissingError);
      await expect(db().gate.count()).rejects.toThrow(/Tenant context missing/);
      expect(await runAsSystem(() => db().gate.count())).toBe(2);
      // Business is not a tenant model, so it works without a context.
      expect(await db().business.count()).toBe(2);
    });

    it('scoping holds inside a transaction', async () => {
      const { a, b } = await twoBusinesses();
      const ids = await runInTenant(a.business.id, () =>
        db().$transaction(async (tx) => {
          await tx.department.create({ data: { name: 'Tx', businessId: tenantId() } });
          return (await tx.gate.findMany()).map((g) => g.id);
        }),
      );
      expect(ids).toEqual([a.gate.id]);
      expect(await ctx.prisma.department.count({ where: { businessId: b.business.id } })).toBe(0);
    });

    it('parallel tenants do not mix', async () => {
      const { a, b } = await twoBusinesses();
      const [ga, gb] = await Promise.all([
        runInTenant(a.business.id, async () => {
          await new Promise((r) => setTimeout(r, 20));
          return db().gate.findMany();
        }),
        runInTenant(b.business.id, () => db().gate.findMany()),
      ]);
      expect(ga.map((g) => g.id)).toEqual([a.gate.id]);
      expect(gb.map((g) => g.id)).toEqual([b.gate.id]);
    });

    it('HTTP request gets the logged-in business, nothing leaks after', async () => {
      const { a } = await twoBusinesses();
      const res = await http().get('/gates').set(auth(a.guardToken)).expect(200);
      expect(res.body.map((g: { id: string }) => g.id)).toEqual([a.gate.id]);
      expect(currentContext()).toBeUndefined();
    });
  });

  describe('flows across businesses', () => {
    const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);

    it('approve, reject and resend on other business visit are 404 and change nothing', async () => {
      const { a, b } = await twoBusinesses();
      const pending = await seedVisit(ctx.prisma, { premisesId: b.site.id, hostId: b.host.id, status: 'PENDING_APPROVAL' });
      for (const path of ['approve', 'reject', 'resend-invite']) {
        const res = await http().post(`/visits/${pending.id}/${path}`).set(auth(a.adminToken)).send({});
        expect([path, res.status]).toEqual([path, 404]);
      }
      expect((await ctx.prisma.visit.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('PENDING_APPROVAL');
      expect(await ctx.prisma.visitEvent.count({ where: { visitId: pending.id } })).toBe(0);
    });

    it('walk-in cannot pick a host from another business', async () => {
      const { a, b } = await twoBusinesses();
      const res = await http()
        .post('/gate/walk-ins')
        .set(auth(a.guardToken))
        .send({
          gateId: a.gate.id,
          hostId: b.host.id,
          phone: '9876543210',
          otp: '123456',
          name: 'R',
          purpose: 'Meeting',
          consent: true,
          clientEventId: randomUUID(),
        })
        .expect(422);
      expect(res.body.message).toMatch(/host/i);
    });

    it('expiry job expires each business visit inside its own business', async () => {
      const { a, b } = await twoBusinesses();
      const past = { validFrom: new Date(Date.now() - 7_200_000), validTo: new Date(Date.now() - 3_600_000) };
      const va = await seedVisit(ctx.prisma, { premisesId: a.site.id, hostId: a.host.id, ...past });
      const vb = await seedVisit(ctx.prisma, { premisesId: b.site.id, hostId: b.host.id, ...past });
      expect(await ctx.app.get(ExpiryJob).run()).toBe(2);
      const events = await ctx.prisma.visitEvent.findMany({ where: { type: 'EXPIRE' } });
      expect(events.map((e) => [e.visitId, e.businessId]).sort()).toEqual(
        [
          [va.id, a.business.id],
          [vb.id, b.business.id],
        ].sort(),
      );
    });

    it('approval timer writes into the visit business', async () => {
      const { b } = await twoBusinesses();
      const visit = await seedVisit(ctx.prisma, { premisesId: b.site.id, hostId: b.host.id, status: 'PENDING_APPROVAL' });
      await ctx.app.get(ApprovalTimerProcessor).process({ name: 'reminder', data: { visitId: visit.id } });
      const event = await ctx.prisma.visitEvent.findFirstOrThrow({ where: { visitId: visit.id, type: 'REMINDER_SENT' } });
      expect(event.businessId).toBe(b.business.id);
      const box = await ctx.prisma.outbox.findFirstOrThrow({ where: { visitId: visit.id } });
      expect(box.businessId).toBe(b.business.id);
    });

    it('public invite link works without login and stays in its business', async () => {
      const { b } = await twoBusinesses();
      const invite = await http()
        .post('/visits')
        .set(auth(b.adminToken))
        .send({
          visitorName: 'Rahul',
          visitorPhone: '9876543210',
          validFrom: new Date(Date.now() + 60_000).toISOString(),
          validTo: new Date(Date.now() + 3_600_000).toISOString(),
          purpose: 'Meeting',
        })
        .expect(201);
      const box = await ctx.prisma.outbox.findFirstOrThrow({ where: { visitId: invite.body.id, template: 'INVITE_LINK' } });
      const token = (box.vars as { link: string }).link.split('/v/')[1];
      const photo = await http()
        .post(`/public/invites/${token}/photo`)
        .attach('photo', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .expect(201);
      await http()
        .post(`/public/invites/${token}/register`)
        .send({ name: 'Rahul Verma', photoKey: photo.body.key, consent: true })
        .expect(201);
      const reg = await ctx.prisma.visitEvent.findFirstOrThrow({ where: { visitId: invite.body.id, type: 'REGISTER' } });
      expect(reg.businessId).toBe(b.business.id);
    });

    it('same clientEventId in two businesses does not leak or crash', async () => {
      const { a, b } = await twoBusinesses();
      const visit = await seedVisit(ctx.prisma, { premisesId: b.site.id, hostId: b.host.id, status: 'CHECKED_IN' });
      const eventId = randomUUID();
      await ctx.prisma.visitEvent.create({
        data: { visitId: visit.id, businessId: b.business.id, type: 'CHECK_IN', clientEventId: eventId },
      });
      const own = await seedVisit(ctx.prisma, { premisesId: a.site.id, hostId: a.host.id });
      const res = await http()
        .post(`/visits/${own.id}/check-in`)
        .set(auth(a.guardToken))
        .send({ gateId: a.gate.id, clientEventId: eventId });
      expect(res.status).toBeLessThan(500);
      expect(JSON.stringify(res.body)).not.toContain(visit.id);
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
