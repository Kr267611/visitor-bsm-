import request from 'supertest';
import { seedSite, seedUser } from './factories';
import { createTestApp, resetData, TestContext, tokenFor } from './setup';

describe('platform (super admin)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  let token: string;
  let planId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetData(ctx);
    const sa = await ctx.prisma.user.create({ data: { name: 'Platform', phone: '+919800099999', role: 'super_admin' } });
    token = await tokenFor(ctx, sa.id);
    planId = (await ctx.prisma.plan.findUniqueOrThrow({ where: { code: 'standard' } })).id;
  });
  afterAll(() => ctx.app.close());

  const newBusiness = (over: Record<string, unknown> = {}) => ({
    name: 'Acme Pvt Ltd',
    slug: 'acme',
    planId,
    premises: { name: 'Head Office', address: 'Pune' },
    admin: { name: 'Asha', phone: '9822200001', email: 'asha@acme.test', password: 'Acme@2026x' },
    ...over,
  });

  it('only super admin can use /platform', async () => {
    const { site } = await seedSite(ctx.prisma);
    const admin = await seedUser(ctx.prisma, site.id, 'admin');
    const adminToken = await tokenFor(ctx, admin.id);
    await http().get('/platform/businesses').set(auth(adminToken)).expect(403);
    await http().post('/platform/plans').set(auth(adminToken)).send({ code: 'x1', name: 'X' }).expect(403);
    await http().get('/platform/businesses').set(auth(token)).expect(200);
  });

  it('creates business with premises, settings, gate and first admin who can log in', async () => {
    const res = await http().post('/platform/businesses').set(auth(token)).send(newBusiness()).expect(201);
    const businessId = res.body.business.id;
    expect(res.body.premises).toMatchObject({ name: 'Head Office', isDefault: true, webSlug: 'head-office' });
    expect(res.body.admin).toEqual({ id: expect.any(String), name: 'Asha', phone: '+919822200001', email: 'asha@acme.test', role: 'admin' });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(await ctx.prisma.premisesSetting.count({ where: { businessId } })).toBe(1);
    expect(await ctx.prisma.gate.count({ where: { businessId } })).toBe(1);

    const login = await http()
      .post('/auth/login')
      .send({ identifier: 'asha@acme.test', password: 'Acme@2026x', deviceName: 'Web' })
      .expect(200);
    const me = await http().get('/me').set(auth(login.body.accessToken)).expect(200);
    expect(me.body.business).toMatchObject({ id: businessId, slug: 'acme' });
    expect(me.body.activePremisesId).toBe(res.body.premises.id);
  });

  it('slug must be unique, and a failure leaves nothing behind', async () => {
    await http().post('/platform/businesses').set(auth(token)).send(newBusiness()).expect(201);
    const before = await ctx.prisma.premises.count();
    const res = await http()
      .post('/platform/businesses')
      .set(auth(token))
      .send(newBusiness({ name: 'Other', admin: { name: 'B', phone: '9822200002' } }))
      .expect(422);
    expect(res.body.error).toBe('VALIDATION_FAILED');
    expect(await ctx.prisma.premises.count()).toBe(before);
  });

  it('bad slug, unknown plan and bad phone are rejected', async () => {
    await http().post('/platform/businesses').set(auth(token)).send(newBusiness({ slug: 'Bad Slug' })).expect(422);
    await http()
      .post('/platform/businesses')
      .set(auth(token))
      .send(newBusiness({ planId: '00000000-0000-0000-0000-000000000000' }))
      .expect(422);
    await http()
      .post('/platform/businesses')
      .set(auth(token))
      .send(newBusiness({ admin: { name: 'A', phone: '123' } }))
      .expect(422);
    expect(await ctx.prisma.business.count()).toBe(0);
  });

  it('plans: create, unknown feature rejected, update', async () => {
    const res = await http()
      .post('/platform/plans')
      .set(auth(token))
      .send({ code: 'basic-x', name: 'Basic', features: ['visitor_desk'], memberLimit: 5 })
      .expect(201);
    expect(res.body).toMatchObject({ features: ['visitor_desk'], memberLimit: 5, premisesLimit: null });
    await http().post('/platform/plans').set(auth(token)).send({ code: 'bad-x', name: 'B', features: ['teleport'] }).expect(422);
    await http().post('/platform/plans').set(auth(token)).send({ code: 'basic-x', name: 'Again' }).expect(422);
    const upd = await http()
      .patch(`/platform/plans/${res.body.id}`)
      .set(auth(token))
      .send({ features: ['visitor_desk', 'dashboard'], memberLimit: null })
      .expect(200);
    expect(upd.body).toMatchObject({ features: ['visitor_desk', 'dashboard'], memberLimit: null });
    await ctx.prisma.plan.delete({ where: { id: res.body.id } });
  });

  it('turning a business off logs its people out', async () => {
    const created = await http().post('/platform/businesses').set(auth(token)).send(newBusiness()).expect(201);
    const adminToken = await tokenFor(ctx, created.body.admin.id);
    await http().get('/me').set(auth(adminToken)).expect(200);
    await http().patch(`/platform/businesses/${created.body.business.id}`).set(auth(token)).send({ isActive: false }).expect(200);
    await http().get('/me').set(auth(adminToken)).expect(401);
    const list = await http().get('/platform/businesses').set(auth(token)).expect(200);
    expect(list.body[0]).toMatchObject({ slug: 'acme', isActive: false, _count: { premises: 1, users: 1 } });
  });
});
