import request from 'supertest';
import { hashPassword, verifyPassword } from '../src/auth/password';
import { FakeSmsProvider } from '../src/notifications/fake-sms.provider';
import { SMS_PROVIDER } from '../src/notifications/sms.provider';
import { RedisService } from '../src/redis/redis.service';
import { seedBusiness, seedSite, seedUser } from './factories';
import { createTestApp, resetData, TestContext } from './setup';

describe('login v2', () => {
  let ctx: TestContext;
  let sms: FakeSmsProvider;
  let pw: string;
  const PASSWORD = 'Gate@12345';
  const http = () => request(ctx.app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const otpFrom = (phone: string) => sms.sent.filter((m) => m.to === phone).at(-1)!.text.match(/\d{6}/)![0];

  beforeAll(async () => {
    ctx = await createTestApp();
    sms = ctx.app.get(SMS_PROVIDER);
    pw = await hashPassword(PASSWORD);
  });
  beforeEach(async () => {
    await resetData(ctx);
    await ctx.app.get(RedisService).client.flushdb();
    sms.sent.length = 0;
  });
  afterAll(() => ctx.app.close());

  async function premisesIn(businessId?: string) {
    return (await seedSite(ctx.prisma, 'Main', businessId ?? (await seedBusiness(ctx.prisma)).id)).site;
  }

  describe('password hashing', () => {
    it('stores scrypt format and verifies', async () => {
      const hash = await hashPassword('secret-pass');
      expect(hash).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
      expect(await verifyPassword('secret-pass', hash)).toBe(true);
      expect(await verifyPassword('secret-pasS', hash)).toBe(false);
      expect(await verifyPassword('x', null)).toBe(false);
      expect(await verifyPassword('x', 'scrypt$999999999$8$1$AA==$AA==')).toBe(false);
    });
  });

  describe('POST /auth/login', () => {
    it('phone + correct password gives a session with business in token', async () => {
      const site = await premisesIn();
      const user = await seedUser(ctx.prisma, site.id, 'guard', { passwordHash: pw });
      const res = await http()
        .post('/auth/login')
        .send({ identifier: user.phone.slice(3), password: PASSWORD, deviceName: 'Gate' })
        .expect(200);
      expect(res.body.user).toEqual({ id: user.id, name: user.name, role: 'guard', businessId: site.businessId });
      const payload = JSON.parse(Buffer.from(res.body.accessToken.split('.')[1], 'base64url').toString());
      expect(payload.businessId).toBe(site.businessId);
      await http().get('/me').set(bearer(res.body.accessToken)).expect(200);
    });

    it('email works, case does not matter', async () => {
      const site = await premisesIn();
      await seedUser(ctx.prisma, site.id, 'admin', { email: 'Admin@Example.com', passwordHash: pw });
      await http()
        .post('/auth/login')
        .send({ identifier: 'admin@example.COM', password: PASSWORD, deviceName: 'Web' })
        .expect(200);
    });

    it('wrong password, unknown user and no password all give the same 401', async () => {
      const site = await premisesIn();
      const withPw = await seedUser(ctx.prisma, site.id, 'guard', { passwordHash: pw });
      const noPw = await seedUser(ctx.prisma, site.id, 'guard');
      for (const [identifier, password] of [
        [withPw.phone, 'wrong-pass'],
        ['+919999999999', PASSWORD],
        [noPw.phone, PASSWORD],
      ]) {
        const res = await http().post('/auth/login').send({ identifier, password, deviceName: 'X' }).expect(401);
        expect(res.body.error).toBe('INVALID_CREDENTIALS');
      }
    });

    it('locks after 10 wrong passwords for that identifier', async () => {
      const site = await premisesIn();
      const user = await seedUser(ctx.prisma, site.id, 'guard', { passwordHash: pw });
      for (let i = 0; i < 10; i++) {
        await http().post('/auth/login').send({ identifier: user.phone, password: 'nope-nope', deviceName: 'X' }).expect(401);
      }
      const res = await http().post('/auth/login').send({ identifier: user.phone, password: PASSWORD, deviceName: 'X' });
      expect(res.status).toBe(429);
      expect(res.body.error).toBe('LOGIN_LOCKED');
    });

    it('inactive user or inactive business cannot log in', async () => {
      const site = await premisesIn();
      const off = await seedUser(ctx.prisma, site.id, 'guard', { passwordHash: pw, isActive: false });
      await http().post('/auth/login').send({ identifier: off.phone, password: PASSWORD, deviceName: 'X' }).expect(401);
      const user = await seedUser(ctx.prisma, site.id, 'guard', { passwordHash: pw });
      await ctx.prisma.business.update({ where: { id: site.businessId }, data: { isActive: false } });
      await http().post('/auth/login').send({ identifier: user.phone, password: PASSWORD, deviceName: 'X' }).expect(401);
    });
  });

  describe('one phone in two businesses', () => {
    async function twoAccounts() {
      const a = await premisesIn();
      const b = await premisesIn();
      const phone = '+919877700000';
      const ua = await seedUser(ctx.prisma, a.id, 'guard', { phone, passwordHash: pw });
      const ub = await seedUser(ctx.prisma, b.id, 'admin', { phone, passwordHash: pw });
      return { a, b, ua, ub, phone };
    }

    it('asks to choose only after the password is right', async () => {
      const { a, b, phone } = await twoAccounts();
      const wrong = await http().post('/auth/login').send({ identifier: phone, password: 'wrong-wrong', deviceName: 'X' });
      expect(wrong.status).toBe(401);
      expect(JSON.stringify(wrong.body)).not.toContain(a.businessId);

      const res = await http().post('/auth/login').send({ identifier: phone, password: PASSWORD, deviceName: 'X' }).expect(409);
      expect(res.body.error).toBe('CHOOSE_BUSINESS');
      expect(res.body.selectionToken).toEqual(expect.any(String));
      expect(res.body.businesses.map((x: { id: string }) => x.id).sort()).toEqual([a.businessId, b.businessId].sort());
    });

    it('choosing gives the session of that business only, token works once', async () => {
      const { b, ub, phone } = await twoAccounts();
      const choose = await http().post('/auth/login').send({ identifier: phone, password: PASSWORD, deviceName: 'X' });
      const body = { selectionToken: choose.body.selectionToken, businessId: b.businessId, deviceName: 'Web' };
      const res = await http().post('/auth/select-business').send(body).expect(200);
      expect(res.body.user).toMatchObject({ id: ub.id, role: 'admin', businessId: b.businessId });
      await http().post('/auth/select-business').send(body).expect(401);
    });

    it('cannot choose a business that was not offered', async () => {
      const { phone } = await twoAccounts();
      const other = await premisesIn();
      const choose = await http().post('/auth/login').send({ identifier: phone, password: PASSWORD, deviceName: 'X' });
      await http()
        .post('/auth/select-business')
        .send({ selectionToken: choose.body.selectionToken, businessId: other.businessId, deviceName: 'X' })
        .expect(401);
    });

    it('password right in only one business logs straight into it', async () => {
      const { ua, ub, phone } = await twoAccounts();
      await ctx.prisma.user.update({ where: { id: ub.id }, data: { passwordHash: await hashPassword('other-pass-1') } });
      const res = await http().post('/auth/login').send({ identifier: phone, password: PASSWORD, deviceName: 'X' }).expect(200);
      expect(res.body.user.id).toBe(ua.id);
    });

    it('OTP also asks to choose', async () => {
      const { phone } = await twoAccounts();
      await http().post('/auth/otp/request').send({ phone }).expect(204);
      const res = await http().post('/auth/otp/verify').send({ phone, otp: otpFrom(phone), deviceName: 'X' }).expect(409);
      expect(res.body.businesses).toHaveLength(2);
    });

    it('OTP skips a business that turned OTP login off', async () => {
      const { b, ua, phone } = await twoAccounts();
      await ctx.prisma.business.update({ where: { id: b.businessId }, data: { otpLogin: false } });
      await http().post('/auth/otp/request').send({ phone }).expect(204);
      const res = await http().post('/auth/otp/verify').send({ phone, otp: otpFrom(phone), deviceName: 'X' }).expect(200);
      expect(res.body.user.id).toBe(ua.id);
    });
  });

  it('OTP is not sent when the only business has OTP login off', async () => {
    const site = await premisesIn();
    const user = await seedUser(ctx.prisma, site.id, 'guard');
    await ctx.prisma.business.update({ where: { id: site.businessId }, data: { otpLogin: false } });
    await http().post('/auth/otp/request').send({ phone: user.phone }).expect(204);
    expect(sms.sent).toHaveLength(0);
  });

  describe('X-Premises-Id', () => {
    async function twoPremisesUser(role: 'guard' | 'admin') {
      const main = await premisesIn();
      const second = (await seedSite(ctx.prisma, 'Plant 2', main.businessId)).site;
      const user = await seedUser(ctx.prisma, main.id, role, { passwordHash: pw });
      const res = await http().post('/auth/login').send({ identifier: user.phone, password: PASSWORD, deviceName: 'X' });
      return { main, second, token: res.body.accessToken as string };
    }

    it('switches to an assigned premises, 403 for one not assigned', async () => {
      const { main, second, token } = await twoPremisesUser('guard');
      const me = await http().get('/me').set(bearer(token)).set('X-Premises-Id', main.id).expect(200);
      expect(me.body.activePremisesId).toBe(main.id);
      const res = await http().get('/me').set(bearer(token)).set('X-Premises-Id', second.id).expect(403);
      expect(res.body.error).toBe('PREMISES_FORBIDDEN');
    });

    it('other business premises is 403 even for an admin', async () => {
      const { token } = await twoPremisesUser('admin');
      const other = await premisesIn();
      await http().get('/me').set(bearer(token)).set('X-Premises-Id', other.id).expect(403);
    });

    it('admin can switch to any premises of the business', async () => {
      const { second, token } = await twoPremisesUser('admin');
      const me = await http().get('/me').set(bearer(token)).set('X-Premises-Id', second.id).expect(200);
      expect(me.body.activePremisesId).toBe(second.id);
      const gates = await http().get('/gates').set(bearer(token)).set('X-Premises-Id', second.id).expect(200);
      expect(gates.body.every((g: { premisesId: string }) => g.premisesId === second.id)).toBe(true);
    });
  });

  describe('PUT /me/password', () => {
    async function otpLogin(phone: string, deviceName: string) {
      await http().post('/auth/otp/request').send({ phone }).expect(204);
      return (await http().post('/auth/otp/verify').send({ phone, otp: otpFrom(phone), deviceName }).expect(200)).body;
    }

    it('OTP user sets a first password, then logs in with it', async () => {
      const site = await premisesIn();
      const user = await seedUser(ctx.prisma, site.id, 'guard');
      const session = await otpLogin(user.phone, 'Phone');
      await http().put('/me/password').set(bearer(session.accessToken)).send({ newPassword: 'New@Pass99' }).expect(204);
      await http().post('/auth/login').send({ identifier: user.phone, password: 'New@Pass99', deviceName: 'X' }).expect(200);
    });

    it('needs the current password, short password rejected', async () => {
      const site = await premisesIn();
      const user = await seedUser(ctx.prisma, site.id, 'guard', { passwordHash: pw });
      const session = await otpLogin(user.phone, 'Phone');
      const auth = bearer(session.accessToken);
      await http().put('/me/password').set(auth).send({ newPassword: 'New@Pass99' }).expect(422);
      await http().put('/me/password').set(auth).send({ currentPassword: 'wrong', newPassword: 'New@Pass99' }).expect(422);
      await http().put('/me/password').set(auth).send({ currentPassword: PASSWORD, newPassword: 'short' }).expect(422);
      await http().put('/me/password').set(auth).send({ currentPassword: PASSWORD, newPassword: 'New@Pass99' }).expect(204);
    });

    it('logs out other devices, keeps this one', async () => {
      const site = await premisesIn();
      const user = await seedUser(ctx.prisma, site.id, 'guard');
      const other = await otpLogin(user.phone, 'Old phone');
      await ctx.app.get(RedisService).client.flushdb();
      const mine = await otpLogin(user.phone, 'New phone');
      await http().put('/me/password').set(bearer(mine.accessToken)).send({ newPassword: 'New@Pass99' }).expect(204);
      await http().get('/me').set(bearer(other.accessToken)).expect(401);
      await http().post('/auth/refresh').send({ refreshToken: other.refreshToken }).expect(401);
      await http().get('/me').set(bearer(mine.accessToken)).expect(200);
    });
  });

  it('refresh stops when the business is turned off', async () => {
    const site = await premisesIn();
    const user = await seedUser(ctx.prisma, site.id, 'guard', { passwordHash: pw });
    const s = await http().post('/auth/login').send({ identifier: user.phone, password: PASSWORD, deviceName: 'X' });
    await ctx.prisma.business.update({ where: { id: site.businessId }, data: { isActive: false } });
    await http().post('/auth/refresh').send({ refreshToken: s.body.refreshToken }).expect(401);
  });

  it('token stops working if the user is moved to another business', async () => {
    const site = await premisesIn();
    const user = await seedUser(ctx.prisma, site.id, 'guard', { passwordHash: pw });
    const s = await http().post('/auth/login').send({ identifier: user.phone, password: PASSWORD, deviceName: 'X' });
    const other = await premisesIn();
    await ctx.prisma.user.update({ where: { id: user.id }, data: { businessId: other.businessId } });
    await http().get('/me').set(bearer(s.body.accessToken)).expect(401);
  });
});
