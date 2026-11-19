import request from 'supertest';
import { seedBusiness, seedSite, seedUser } from './factories';
import { createTestApp, resetData, TestContext, tokenFor } from './setup';

describe('users bulk upload', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(() => resetData(ctx));
  afterAll(() => ctx.app.close());

  async function setup(businessId?: string) {
    const { site, business } = await seedSite(ctx.prisma, 'Head Office', businessId ?? (await seedBusiness(ctx.prisma)).id);
    const admin = await seedUser(ctx.prisma, site.id, 'admin');
    return { site, business, admin, token: await tokenFor(ctx, admin.id) };
  }

  const send = (token: string, rows: object[]) => http().post('/admin/users/import').set(auth(token)).send({ rows });

  it('creates users, departments and designations; matches existing names in any capitals', async () => {
    const { site, token } = await setup();
    const mis = await http().post('/admin/departments').set(auth(token)).send({ name: 'MIS' }).expect(201);
    await http().post(`/admin/departments/${mis.body.id}/designations`).set(auth(token)).send({ name: 'Executive' }).expect(201);

    const res = await send(token, [
      { name: 'Abhishek Sah', mobile: '63528 72742', department: 'mis', designation: 'executive', password: 'abhi26' },
      { name: 'Alka Mishra', mobile: '9198164246', role: 'Guard', department: 'Q.C', designation: 'Inspector', password: 'alka26', host: 'no' },
      { name: 'Amit', mobile: '+91 6393698900', email: 'Amit@BSM.in', role: 'doer', password: 'amit26' },
    ]).expect(200);
    expect(res.body).toEqual({ created: 3, departmentsCreated: 1, designationsCreated: 1 });

    const users = await http().get('/admin/users').set(auth(token)).expect(200);
    const byName = (n: string) => users.body.find((u: { name: string }) => u.name === n);
    expect(byName('Abhishek Sah')).toMatchObject({
      phone: '+916352872742',
      role: 'employee',
      departmentId: mis.body.id,
      designation: 'Executive',
      premisesIds: [site.id],
      isHost: true,
    });
    expect(byName('Alka Mishra')).toMatchObject({ role: 'guard', designation: 'Inspector', isHost: false });
    expect(byName('Amit')).toMatchObject({ email: 'amit@bsm.in', role: 'employee', departmentId: null });

    // The uploaded password works.
    await http().post('/auth/login').send({ identifier: '6352872742', password: 'abhi26', deviceName: 'X' }).expect(200);
  });

  it('all or nothing: every bad row comes back with its line, nothing is saved', async () => {
    const { token } = await setup();
    await seedUser(ctx.prisma, (await ctx.prisma.premises.findFirstOrThrow()).id, 'employee', { phone: '+919811100009' });
    const res = await send(token, [
      { name: 'Good', mobile: '9811100001', password: 'good26' },
      { name: '', mobile: '12345', password: '123' },
      { name: 'Twice', mobile: '9811100001', password: 'twice1' },
      { name: 'Boss', mobile: '9811100002', role: 'king', password: 'boss26' },
      { name: 'Exists', mobile: '9811100009', password: 'exist1' },
      { name: 'Lost', mobile: '9811100003', password: 'lost26', premises: 'Plant 9' },
      { name: 'Title', mobile: '9811100004', password: 'title1', designation: 'Manager' },
    ]).expect(422);
    expect(res.body.message).toBe('6 row(s) need fixing. Nothing was saved.');
    expect(res.body.rows).toEqual([
      { line: 3, errors: ['Name is missing.', 'Mobile must be a valid 10-digit number.', 'Password must be at least 6 characters.'] },
      { line: 4, errors: ['Mobile is repeated (also on line 2).'] },
      { line: 5, errors: ['Role must be one of: Employee, Guard, Reception, Security, Admin.'] },
      { line: 6, errors: ['A user with this mobile already exists.'] },
      { line: 7, errors: ['Premises "Plant 9" was not found.'] },
      { line: 8, errors: ['A designation needs a department.'] },
    ]);
    expect(await ctx.prisma.user.count({ where: { name: 'Good' } })).toBe(0);
  });

  it('only for admins with Users access; stays inside the business', async () => {
    const a = await setup();
    const b = await setup();
    const guard = await seedUser(ctx.prisma, a.site.id, 'guard');
    await send(await tokenFor(ctx, guard.id), [{ name: 'X', mobile: '9811100005', password: 'xxxxxx' }]).expect(403);

    // The same mobile may exist in another business.
    await seedUser(ctx.prisma, b.site.id, 'employee', { phone: '+919811100006' });
    await send(a.token, [{ name: 'Same', mobile: '9811100006', password: 'same26', premises: 'head office' }]).expect(200);
    const inB = await http().get('/admin/users').set(auth(b.token)).expect(200);
    expect(inB.body.some((u: { name: string }) => u.name === 'Same')).toBe(false);
  });
});
