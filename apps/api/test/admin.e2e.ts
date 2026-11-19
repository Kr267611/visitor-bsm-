import request from 'supertest';
import { createTestApp, resetData, TestContext, tokenFor } from './setup';
import { seedSite, seedUser } from './factories';

describe('admin', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(() => resetData(ctx));
  afterAll(() => ctx.app.close());

  async function adminSetup() {
    const { site, gate } = await seedSite(ctx.prisma);
    const admin = await seedUser(ctx.prisma, site.id, 'admin');
    return { site, gate, admin, token: await tokenFor(ctx, admin.id) };
  }

  it('admin creates user with normalized phone', async () => {
    const { site, token } = await adminSetup();
    const res = await http()
      .post('/admin/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Amit', phone: '98765 43210', role: 'guard', premisesIds: [site.id], password: 'amit26' })
      .expect(201);
    expect(res.body.phone).toBe('+919876543210');
    expect(res.body.isActive).toBe(true);
  });

  it('duplicate phone rejected', async () => {
    const { site, token } = await adminSetup();
    const body = { name: 'Amit', phone: '9876543210', role: 'guard', premisesIds: [site.id], password: 'amit26' };
    await http().post('/admin/users').set('Authorization', `Bearer ${token}`).send(body).expect(201);
    const res = await http().post('/admin/users').set('Authorization', `Bearer ${token}`).send(body);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('VALIDATION_FAILED');
  });

  it('a new member must have a password of at least 6 characters', async () => {
    const { site, token } = await adminSetup();
    const body = { name: 'Amit', phone: '9876543210', role: 'guard', premisesIds: [site.id] };
    const send = (extra: object) =>
      http().post('/admin/users').set('Authorization', `Bearer ${token}`).send({ ...body, ...extra });
    await send({}).expect(422);
    await send({ password: '12345' }).expect(422);
    await send({ password: '123456' }).expect(201);
  });

  it('invalid role rejected', async () => {
    const { site, token } = await adminSetup();
    await http()
      .post('/admin/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Amit', phone: '9876543210', role: 'boss', premisesIds: [site.id] })
      .expect(422);
  });

  it('non-admin cannot list users', async () => {
    const { site } = await seedSite(ctx.prisma);
    const guard = await seedUser(ctx.prisma, site.id, 'guard');
    const res = await http().get('/admin/users').set('Authorization', `Bearer ${await tokenFor(ctx, guard.id)}`);
    expect(res.status).toBe(403);
  });

  it('admin deactivates user with PATCH, row stays', async () => {
    const { site, token } = await adminSetup();
    const guard = await seedUser(ctx.prisma, site.id, 'guard');
    const res = await http()
      .patch(`/admin/users/${guard.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false })
      .expect(200);
    expect(res.body.isActive).toBe(false);
    expect(await ctx.prisma.user.count({ where: { id: guard.id } })).toBe(1);
  });

  it('admin manages sites and gates', async () => {
    const { token } = await adminSetup();
    const site = await http()
      .post('/admin/premises')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Plant 2', address: 'Surat' })
      .expect(201);
    const gate = await http()
      .post('/admin/gates')
      .set('Authorization', `Bearer ${token}`)
      .send({ premisesId: site.body.id, name: 'Gate 2' })
      .expect(201);
    expect(gate.body.premisesId).toBe(site.body.id);
    const list = await http().get('/admin/gates').set('Authorization', `Bearer ${token}`).expect(200);
    expect(list.body.map((g: { name: string }) => g.name)).toContain('Gate 2');
    const patched = await http()
      .patch(`/admin/gates/${gate.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false })
      .expect(200);
    expect(patched.body.isActive).toBe(false);
  });

  it('guard lists active gates of own site', async () => {
    const { site, gate } = await seedSite(ctx.prisma);
    const other = await seedSite(ctx.prisma, 'Other');
    const guard = await seedUser(ctx.prisma, site.id, 'guard');
    const res = await http()
      .get('/gates')
      .set('Authorization', `Bearer ${await tokenFor(ctx, guard.id)}`)
      .expect(200);
    const ids = res.body.map((g: { id: string }) => g.id);
    expect(ids).toContain(gate.id);
    expect(ids).not.toContain(other.gate.id);
  });

  it('GET /me returns own profile', async () => {
    const { site } = await seedSite(ctx.prisma);
    const user = await seedUser(ctx.prisma, site.id);
    const res = await http().get('/me').set('Authorization', `Bearer ${await tokenFor(ctx, user.id)}`).expect(200);
    expect(res.body.id).toBe(user.id);
    expect(res.body.delegateId).toBeNull();
  });

  it('delegate can be set and cleared', async () => {
    const { site } = await seedSite(ctx.prisma);
    const user = await seedUser(ctx.prisma, site.id);
    const backup = await seedUser(ctx.prisma, site.id);
    const token = await tokenFor(ctx, user.id);
    const set = await http().patch('/me').set('Authorization', `Bearer ${token}`).send({ delegateId: backup.id }).expect(200);
    expect(set.body.delegateId).toBe(backup.id);
    expect(set.body.delegateName).toBe(backup.name);
    const cleared = await http().patch('/me').set('Authorization', `Bearer ${token}`).send({ delegateId: null }).expect(200);
    expect(cleared.body.delegateId).toBeNull();
  });

  it('delegate must be active user at same site', async () => {
    const { site } = await seedSite(ctx.prisma);
    const other = await seedSite(ctx.prisma, 'Other');
    const user = await seedUser(ctx.prisma, site.id);
    const inactive = await seedUser(ctx.prisma, site.id, 'employee', { isActive: false });
    const elsewhere = await seedUser(ctx.prisma, other.site.id);
    const token = await tokenFor(ctx, user.id);
    for (const delegateId of [inactive.id, elsewhere.id]) {
      await http().patch('/me').set('Authorization', `Bearer ${token}`).send({ delegateId }).expect(422);
    }
  });

  it('cannot set self as delegate', async () => {
    const { site } = await seedSite(ctx.prisma);
    const user = await seedUser(ctx.prisma, site.id);
    await http()
      .patch('/me')
      .set('Authorization', `Bearer ${await tokenFor(ctx, user.id)}`)
      .send({ delegateId: user.id })
      .expect(422);
  });

  it('host search hides phone and other sites', async () => {
    const { site } = await seedSite(ctx.prisma);
    const other = await seedSite(ctx.prisma, 'Other');
    const guard = await seedUser(ctx.prisma, site.id, 'guard');
    const host = await seedUser(ctx.prisma, site.id, 'employee', { name: 'Anita Singh' });
    await seedUser(ctx.prisma, other.site.id, 'employee', { name: 'Anita Other' });
    await seedUser(ctx.prisma, site.id, 'employee', { name: 'Anita Gone', isActive: false });
    const res = await http()
      .get('/users/hosts?q=anita')
      .set('Authorization', `Bearer ${await tokenFor(ctx, guard.id)}`)
      .expect(200);
    expect(res.body).toEqual([{ id: host.id, name: 'Anita Singh', department: null }]);
  });
});
