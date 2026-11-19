import request from 'supertest';
import { seedBusiness, seedSite, seedUser } from './factories';
import { createTestApp, resetData, TestContext, tokenFor } from './setup';

describe('admin v2', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(() => resetData(ctx));
  afterAll(() => ctx.app.close());

  async function adminOf(businessId?: string) {
    const { site, gate, business } = await seedSite(ctx.prisma, 'Main', businessId ?? (await seedBusiness(ctx.prisma)).id);
    const admin = await seedUser(ctx.prisma, site.id, 'admin');
    return { site, gate, business, admin, token: await tokenFor(ctx, admin.id) };
  }

  describe('premises settings', () => {
    it('reads defaults and saves changes', async () => {
      const { site, token } = await adminOf();
      const got = await http().get(`/admin/premises/${site.id}/settings`).set(auth(token)).expect(200);
      expect(got.body).toMatchObject({ premisesId: site.id, defaultVisitMin: 240, slotMin: 30, checkinOnApproval: true });
      const put = await http()
        .put(`/admin/premises/${site.id}/settings`)
        .set(auth(token))
        .send({ visitStart: '09:00', visitEnd: '18:30', overstayMin: 30, reportEmails: ['ops@acme.test'], reportSchedule: 'daily' })
        .expect(200);
      expect(put.body).toMatchObject({ visitStart: '09:00', visitEnd: '18:30', overstayMin: 30, reportSchedule: 'daily' });
    });

    it('rejects bad values and unknown fields', async () => {
      const { site, token } = await adminOf();
      const url = `/admin/premises/${site.id}/settings`;
      for (const body of [
        { visitStart: '9am' },
        { visitStart: '18:00', visitEnd: '09:00' },
        { slotMin: 0 },
        { reportEmails: ['not-an-email'] },
        { googleReviewUrl: 'http://insecure.test' },
        { businessId: site.businessId },
        { exitPlanKey: 'x' },
      ]) {
        const res = await http().put(url).set(auth(token)).send(body);
        expect([body, res.status]).toEqual([body, 422]);
      }
    });

    it('other business settings are 404', async () => {
      const a = await adminOf();
      const b = await adminOf();
      await http().get(`/admin/premises/${b.site.id}/settings`).set(auth(a.token)).expect(404);
      await http().put(`/admin/premises/${b.site.id}/settings`).set(auth(a.token)).send({ slotMin: 15 }).expect(404);
      expect((await ctx.prisma.premisesSetting.findUniqueOrThrow({ where: { premisesId: b.site.id } })).slotMin).toBe(30);
    });
  });

  describe('premises', () => {
    it('making another premises default moves the flag, default cannot just be switched off', async () => {
      const { site, token } = await adminOf();
      const second = await http().post('/admin/premises').set(auth(token)).send({ name: 'Plant 2' }).expect(201);
      await http().patch(`/admin/premises/${site.id}`).set(auth(token)).send({ isDefault: false }).expect(422);
      await http().patch(`/admin/premises/${second.body.id}`).set(auth(token)).send({ isDefault: true }).expect(200);
      const list = await http().get('/admin/premises').set(auth(token)).expect(200);
      expect(list.body.filter((p: { isDefault: boolean }) => p.isDefault).map((p: { id: string }) => p.id)).toEqual([second.body.id]);
    });

    it('same premises name gets a different web slug', async () => {
      const { token } = await adminOf();
      const one = await http().post('/admin/premises').set(auth(token)).send({ name: 'Warehouse' }).expect(201);
      const two = await http().post('/admin/premises').set(auth(token)).send({ name: 'Warehouse' }).expect(201);
      expect(one.body.webSlug).toBe('warehouse');
      expect(two.body.webSlug).toBe('warehouse-2');
    });
  });

  describe('departments', () => {
    it('create, rename, list with member count, delete keeps members', async () => {
      const { site, token } = await adminOf();
      const dept = await http().post('/admin/departments').set(auth(token)).send({ name: 'Finance' }).expect(201);
      const member = await seedUser(ctx.prisma, site.id, 'employee');
      await ctx.prisma.user.update({ where: { id: member.id }, data: { departmentId: dept.body.id } });
      await http().patch(`/admin/departments/${dept.body.id}`).set(auth(token)).send({ name: 'Accounts' }).expect(200);
      const list = await http().get('/admin/departments').set(auth(token)).expect(200);
      expect(list.body).toEqual([expect.objectContaining({ name: 'Accounts', memberCount: 1 })]);
      await http().delete(`/admin/departments/${dept.body.id}`).set(auth(token)).expect(204);
      const after = await ctx.prisma.user.findUniqueOrThrow({ where: { id: member.id } });
      expect(after.departmentId).toBeNull();
      expect(after.isActive).toBe(true);
    });

    it('designations: listed under their department; rename and remove follow to members', async () => {
      const { site, token } = await adminOf();
      const dept = await http().post('/admin/departments').set(auth(token)).send({ name: 'MIS' }).expect(201);
      const add = (name: string) =>
        http().post(`/admin/departments/${dept.body.id}/designations`).set(auth(token)).send({ name });
      const exec = await add('Executive').expect(201);
      await add('Manager').expect(201);
      await add('Executive').expect(422); // unique inside the department
      await add(' ').expect(422);

      const list = await http().get('/admin/departments').set(auth(token)).expect(200);
      expect(list.body[0].designations).toEqual([
        { id: exec.body.id, name: 'Executive' },
        { id: expect.any(String), name: 'Manager' },
      ]);

      const member = await seedUser(ctx.prisma, site.id, 'employee');
      await ctx.prisma.user.update({ where: { id: member.id }, data: { departmentId: dept.body.id, designation: 'Executive' } });
      await http().patch(`/admin/designations/${exec.body.id}`).set(auth(token)).send({ name: 'Senior Executive' }).expect(200);
      expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: member.id } })).designation).toBe('Senior Executive');

      await http().delete(`/admin/designations/${exec.body.id}`).set(auth(token)).expect(204);
      const after = await ctx.prisma.user.findUniqueOrThrow({ where: { id: member.id } });
      expect(after.designation).toBeNull();
      expect(after.departmentId).toBe(dept.body.id);

      // Deleting the department removes its designations too.
      await http().delete(`/admin/departments/${dept.body.id}`).set(auth(token)).expect(204);
      expect(await ctx.prisma.designation.count()).toBe(0);
    });

    it('designations of another business cannot be seen or changed', async () => {
      const a = await adminOf();
      const b = await adminOf();
      const dept = await http().post('/admin/departments').set(auth(a.token)).send({ name: 'QC' }).expect(201);
      const des = await http()
        .post(`/admin/departments/${dept.body.id}/designations`)
        .set(auth(a.token))
        .send({ name: 'Inspector' })
        .expect(201);
      await http()
        .post(`/admin/departments/${dept.body.id}/designations`)
        .set(auth(b.token))
        .send({ name: 'Spy' })
        .expect(404);
      await http().patch(`/admin/designations/${des.body.id}`).set(auth(b.token)).send({ name: 'X' }).expect(404);
      await http().delete(`/admin/designations/${des.body.id}`).set(auth(b.token)).expect(404);
      const listB = await http().get('/admin/departments').set(auth(b.token)).expect(200);
      expect(listB.body).toEqual([]);
      expect(await ctx.prisma.designation.count()).toBe(1);
    });

    it('name unique inside a business only', async () => {
      const a = await adminOf();
      const b = await adminOf();
      await http().post('/admin/departments').set(auth(a.token)).send({ name: 'HR' }).expect(201);
      await http().post('/admin/departments').set(auth(a.token)).send({ name: 'HR' }).expect(422);
      await http().post('/admin/departments').set(auth(b.token)).send({ name: 'HR' }).expect(201);
    });

    it('other business department is 404', async () => {
      const a = await adminOf();
      const b = await adminOf();
      const dept = await http().post('/admin/departments').set(auth(b.token)).send({ name: 'Ops' }).expect(201);
      await http().patch(`/admin/departments/${dept.body.id}`).set(auth(a.token)).send({ name: 'X' }).expect(404);
      await http().delete(`/admin/departments/${dept.body.id}`).set(auth(a.token)).expect(404);
      const list = await http().get('/admin/departments').set(auth(a.token)).expect(200);
      expect(list.body).toEqual([]);
      // An admin cannot give their member another business's department.
      await http()
        .patch(`/admin/users/${a.admin.id}`)
        .set(auth(a.token))
        .send({ departmentId: dept.body.id })
        .expect(422);
    });
  });

  describe('members', () => {
    it('created with a password can log in; password never comes back', async () => {
      const { site, token } = await adminOf();
      const res = await http()
        .post('/admin/users')
        .set(auth(token))
        .send({ name: 'Ravi', phone: '9811144444', role: 'employee', premisesIds: [site.id], password: 'Ravi@2026x', designation: 'Manager' })
        .expect(201);
      expect(res.body).toMatchObject({ name: 'Ravi', designation: 'Manager', premisesIds: [site.id] });
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);
      await http().post('/auth/login').send({ identifier: '9811144444', password: 'Ravi@2026x', deviceName: 'X' }).expect(200);
    });

    it('admin password reset logs the member out everywhere', async () => {
      const { site, token } = await adminOf();
      const member = await seedUser(ctx.prisma, site.id, 'guard');
      const memberToken = await tokenFor(ctx, member.id);
      await http().get('/me').set(auth(memberToken)).expect(200);
      await http().put(`/admin/users/${member.id}/password`).set(auth(token)).send({ password: 'short' }).expect(422);
      await http().put(`/admin/users/${member.id}/password`).set(auth(token)).send({ password: 'Fresh@2026x' }).expect(204);
      await http().get('/me').set(auth(memberToken)).expect(401);
      await http().post('/auth/login').send({ identifier: member.phone, password: 'Fresh@2026x', deviceName: 'X' }).expect(200);
    });

    it('cannot reset password of another business member', async () => {
      const a = await adminOf();
      const b = await adminOf();
      await http().put(`/admin/users/${b.admin.id}/password`).set(auth(a.token)).send({ password: 'Hacked@2026' }).expect(404);
      expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: b.admin.id } })).passwordHash).toBeNull();
    });

    it('search by name or phone', async () => {
      const { site, token } = await adminOf();
      await seedUser(ctx.prisma, site.id, 'employee', { name: 'Kavita Rao', phone: '+919855500001' });
      const byName = await http().get('/admin/users?q=kavita').set(auth(token)).expect(200);
      expect(byName.body.map((u: { name: string }) => u.name)).toEqual(['Kavita Rao']);
      const byPhone = await http().get('/admin/users?q=98555').set(auth(token)).expect(200);
      expect(byPhone.body).toHaveLength(1);
    });
  });

  describe('audit log', () => {
    it('records who changed what, before and after, without password', async () => {
      const { site, admin, token } = await adminOf();
      const created = await http()
        .post('/admin/users')
        .set(auth(token))
        .send({ name: 'Nina', phone: '9811155555', role: 'guard', premisesIds: [site.id], password: 'Nina@2026x' })
        .expect(201);
      await http().patch(`/admin/users/${created.body.id}`).set(auth(token)).send({ role: 'reception' }).expect(200);
      await http().put(`/admin/users/${created.body.id}/password`).set(auth(token)).send({ password: 'Nina@2027x' }).expect(204);
      await http().put(`/admin/premises/${site.id}/settings`).set(auth(token)).send({ slotMin: 15 }).expect(200);

      const res = await http().get(`/admin/audit?entity=user&entityId=${created.body.id}`).set(auth(token)).expect(200);
      expect(res.body.map((r: { action: string }) => r.action)).toEqual(['password_reset', 'update', 'create']);
      const update = res.body[1];
      expect(update).toMatchObject({ actorId: admin.id, before: { role: 'guard' }, after: { role: 'reception' } });
      expect(JSON.stringify(res.body)).not.toMatch(/scrypt|passwordHash|Nina@/);

      const settings = await http().get('/admin/audit?entity=premises_settings').set(auth(token)).expect(200);
      expect(settings.body[0]).toMatchObject({ before: { slotMin: 30 }, after: { slotMin: 15 } });
    });

    it('failed change writes no audit row', async () => {
      const { site, token } = await adminOf();
      await http().post('/admin/departments').set(auth(token)).send({ name: 'Ops' }).expect(201);
      await http().post('/admin/departments').set(auth(token)).send({ name: 'Ops' }).expect(422);
      expect(await ctx.prisma.auditLog.count({ where: { entity: 'department' } })).toBe(1);
      expect(site).toBeTruthy();
    });

    it('audit list shows only own business', async () => {
      const a = await adminOf();
      const b = await adminOf();
      await http().post('/admin/departments').set(auth(b.token)).send({ name: 'Secret' }).expect(201);
      const res = await http().get('/admin/audit').set(auth(a.token)).expect(200);
      expect(res.body).toEqual([]);
    });

    it('non-admin cannot read the audit log', async () => {
      const { site } = await adminOf();
      const guard = await seedUser(ctx.prisma, site.id, 'guard');
      await http().get('/admin/audit').set(auth(await tokenFor(ctx, guard.id))).expect(403);
    });
  });
});
