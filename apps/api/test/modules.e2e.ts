import request from 'supertest';
import { hashPassword } from '../src/auth/password';
import { seedSite, seedUser } from './factories';
import { createTestApp, resetData, TestContext, tokenFor } from './setup';

describe('module access per member', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(() => resetData(ctx));
  afterAll(() => ctx.app.close());

  async function setup() {
    const { site } = await seedSite(ctx.prisma);
    const admin = await seedUser(ctx.prisma, site.id, 'admin');
    return { site, admin, token: await tokenFor(ctx, admin.id) };
  }

  it('no ticks saved: everything the role allows, shown on /me', async () => {
    const { site, token } = await setup();
    const guard = await seedUser(ctx.prisma, site.id, 'guard');
    const me = await http().get('/me').set(auth(token)).expect(200);
    expect(me.body.modules).toEqual(['desk', 'visitors', 'users', 'premises', 'departments', 'devices']);
    const guardMe = await http().get('/me').set(auth(await tokenFor(ctx, guard.id))).expect(200);
    expect(guardMe.body.modules).toEqual(['desk']);
  });

  it('an admin with only Users ticked can manage users and nothing else', async () => {
    const { site, admin, token } = await setup();
    const hr = await seedUser(ctx.prisma, site.id, 'admin');
    await http().patch(`/admin/users/${hr.id}`).set(auth(token)).send({ modules: ['users'] }).expect(200);
    const hrToken = await tokenFor(ctx, hr.id);

    await http().get('/admin/users').set(auth(hrToken)).expect(200);
    const blocked = await http().get('/admin/departments').set(auth(hrToken)).expect(403);
    expect(blocked.body).toMatchObject({ error: 'MODULE_FORBIDDEN', module: 'departments' });
    await http().get('/admin/premises').set(auth(hrToken)).expect(403);
    await http().get('/admin/devices').set(auth(hrToken)).expect(403);
    await http().get('/dashboard/live').set(auth(hrToken)).expect(403);
    const me = await http().get('/me').set(auth(hrToken)).expect(200);
    expect(me.body.modules).toEqual(['users']);

    // The change shows in the list, and the first admin is untouched.
    const list = await http().get('/admin/users').set(auth(token)).expect(200);
    expect(list.body.find((u: { id: string }) => u.id === hr.id).modules).toEqual(['users']);
    expect(list.body.find((u: { id: string }) => u.id === admin.id).modules).toEqual([]);
  });

  it('ticks never go beyond the role', async () => {
    const { site, token } = await setup();
    const guard = await seedUser(ctx.prisma, site.id, 'guard');
    await http().patch(`/admin/users/${guard.id}`).set(auth(token)).send({ modules: ['desk', 'users'] }).expect(200);
    const guardToken = await tokenFor(ctx, guard.id);
    await http().get('/admin/users').set(auth(guardToken)).expect(403);
    const me = await http().get('/me').set(auth(guardToken)).expect(200);
    expect(me.body.modules).toEqual(['desk']);
  });

  it('an employee without My visitors cannot send invites', async () => {
    const { site, token } = await setup();
    const employee = await seedUser(ctx.prisma, site.id, 'employee');
    await http().patch(`/admin/users/${employee.id}`).set(auth(token)).send({ modules: ['desk'] }).expect(200);
    const res = await http()
      .post('/visits')
      .set(auth(await tokenFor(ctx, employee.id)))
      .send({ visitorName: 'Asha', visitorPhone: '9811100001', expectedAt: new Date(Date.now() + 3_600_000).toISOString() })
      .expect(403);
    expect(res.body.error).toBe('MODULE_FORBIDDEN');
  });

  it('unknown module names are rejected; new members can start with ticks', async () => {
    const { site, token } = await setup();
    const member = await seedUser(ctx.prisma, site.id, 'reception');
    await http().patch(`/admin/users/${member.id}`).set(auth(token)).send({ modules: ['reports'] }).expect(422);
    const created = await http()
      .post('/admin/users')
      .set(auth(token))
      .send({ name: 'Kiran', phone: '9811100002', role: 'reception', premisesIds: [site.id], password: 'kiran1', modules: ['desk'] })
      .expect(201);
    expect(created.body.modules).toEqual(['desk']);
  });

  describe('an admin cannot lock themselves out', () => {
    it('cannot deactivate self, change own role, or drop own Users access', async () => {
      const { admin, token } = await setup();
      const self = (body: object) => http().patch(`/admin/users/${admin.id}`).set(auth(token)).send(body);
      expect((await self({ isActive: false }).expect(422)).body.message).toBe('You cannot deactivate your own account.');
      expect((await self({ role: 'employee' }).expect(422)).body.message).toBe('You cannot change your own role.');
      expect((await self({ modules: ['desk', 'premises'] }).expect(422)).body.message).toBe(
        'You cannot remove your own access to Users.',
      );
      // Narrowing yourself while keeping Users is fine.
      await self({ modules: ['users', 'premises'] }).expect(200);
      await self({ name: 'Deepak' }).expect(200);
    });

    it('can still deactivate another admin', async () => {
      const { site, token } = await setup();
      const other = await seedUser(ctx.prisma, site.id, 'admin');
      await http().patch(`/admin/users/${other.id}`).set(auth(token)).send({ isActive: false }).expect(200);
    });
  });

  it('records the last sign-in time (sign-in only, not token refresh)', async () => {
    const { site, token } = await setup();
    const member = await seedUser(ctx.prisma, site.id, 'employee', { passwordHash: await hashPassword('secret1') });
    let list = await http().get('/admin/users').set(auth(token)).expect(200);
    expect(list.body.find((u: { id: string }) => u.id === member.id).lastLoginAt).toBeNull();

    const before = Date.now();
    const login = await http()
      .post('/auth/login')
      .send({ identifier: member.phone, password: 'secret1', deviceName: 'Phone' })
      .expect(200);
    list = await http().get('/admin/users').set(auth(token)).expect(200);
    const first = list.body.find((u: { id: string }) => u.id === member.id).lastLoginAt;
    expect(new Date(first).getTime()).toBeGreaterThanOrEqual(before - 1000);

    await http().post('/auth/refresh').send({ refreshToken: login.body.refreshToken }).expect(200);
    list = await http().get('/admin/users').set(auth(token)).expect(200);
    expect(list.body.find((u: { id: string }) => u.id === member.id).lastLoginAt).toBe(first);
  });
});
