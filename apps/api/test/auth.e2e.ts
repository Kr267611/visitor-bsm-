import { Controller, Get, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Roles } from '../src/auth/roles.decorator';
import { configureApp } from '../src/configure-app';
import { SMS_PROVIDER } from '../src/notifications/sms.provider';
import { FakeSmsProvider } from '../src/notifications/fake-sms.provider';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { seedSite, seedUser } from './factories';

@Controller('test-admin')
class AdminOnlyController {
  @Roles('admin')
  @Get()
  ok() {
    return { ok: true };
  }
}
@Module({ controllers: [AdminOnlyController] })
class TestRoutes {}

describe('auth', () => {
  let app: any;
  let prisma: PrismaService;
  let redis: RedisService;
  let sms: FakeSmsProvider;
  const http = () => request(app.getHttpServer());
  const otpFrom = (phone: string) =>
    sms.sent.filter((m) => m.to === phone).at(-1)!.text.match(/\d{6}/)![0];

  async function login(phone: string, deviceName = 'Gate phone') {
    await http().post('/auth/otp/request').send({ phone }).expect(204);
    const res = await http().post('/auth/otp/verify').send({ phone, otp: otpFrom(phone), deviceName });
    return res;
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule, TestRoutes] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    sms = app.get(SMS_PROVIDER);
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE visit_events, outbox, refresh_tokens, devices, visits, visitors, users, gates, sites CASCADE',
    );
    await redis.client.flushdb();
    sms.sent.length = 0;
  });
  afterAll(() => app.close());

  it('correct OTP logs in', async () => {
    const { site } = await seedSite(prisma);
    const user = await seedUser(prisma, site.id, 'guard');
    const res = await login(user.phone);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.deviceId).toBeTruthy();
    expect(res.body.user).toEqual({ id: user.id, name: user.name, role: 'guard', siteId: site.id });
  });

  it('accepts other phone formats for the same user', async () => {
    const { site } = await seedSite(prisma);
    const user = await seedUser(prisma, site.id, 'guard', { phone: '+919876543210' });
    await http().post('/auth/otp/request').send({ phone: '98765 43210' }).expect(204);
    const res = await http()
      .post('/auth/otp/verify')
      .send({ phone: '098765-43210', otp: otpFrom(user.phone), deviceName: 'x' });
    expect(res.status).toBe(200);
  });

  it('6th wrong attempt blocks even correct OTP', async () => {
    const { site } = await seedSite(prisma);
    const user = await seedUser(prisma, site.id);
    await http().post('/auth/otp/request').send({ phone: user.phone }).expect(204);
    const otp = otpFrom(user.phone);
    const wrong = otp === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const r = await http().post('/auth/otp/verify').send({ phone: user.phone, otp: wrong, deviceName: 'x' });
      expect(r.status).toBe(401);
      expect(r.body.error).toBe('INVALID_OTP');
    }
    const r = await http().post('/auth/otp/verify').send({ phone: user.phone, otp, deviceName: 'x' });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('INVALID_OTP');
  });

  it('OTP works only once', async () => {
    const { site } = await seedSite(prisma);
    const user = await seedUser(prisma, site.id);
    expect((await login(user.phone)).status).toBe(200);
    const again = await http()
      .post('/auth/otp/verify')
      .send({ phone: user.phone, otp: otpFrom(user.phone), deviceName: 'x' });
    expect(again.status).toBe(401);
  });

  it('4th request in 10 min rate limited', async () => {
    const { site } = await seedSite(prisma);
    const user = await seedUser(prisma, site.id);
    for (let i = 0; i < 3; i++) {
      await http().post('/auth/otp/request').send({ phone: user.phone }).expect(204);
    }
    const r = await http().post('/auth/otp/request').send({ phone: user.phone });
    expect(r.status).toBe(429);
    expect(r.body.error).toBe('OTP_RATE_LIMITED');
  });

  it('unknown phone returns 204, sends no SMS', async () => {
    await http().post('/auth/otp/request').send({ phone: '+919000000001' }).expect(204);
    expect(sms.sent).toHaveLength(0);
  });

  it('inactive user cannot log in', async () => {
    const { site } = await seedSite(prisma);
    const user = await seedUser(prisma, site.id, 'guard', { isActive: false });
    await http().post('/auth/otp/request').send({ phone: user.phone }).expect(204);
    expect(sms.sent).toHaveLength(0);
    const r = await http().post('/auth/otp/verify').send({ phone: user.phone, otp: '123456', deviceName: 'x' });
    expect(r.status).toBe(401);
  });

  it('old refresh token rejected after rotation', async () => {
    const { site } = await seedSite(prisma);
    const user = await seedUser(prisma, site.id);
    const first = (await login(user.phone)).body;
    const second = await http().post('/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(second.status).toBe(200);
    expect(second.body.refreshToken).not.toBe(first.refreshToken);
    await prisma.refreshToken.updateMany({
      where: { revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });
    await http().post('/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401);
  });

  it('revoked device cannot refresh', async () => {
    const { site } = await seedSite(prisma);
    const admin = await seedUser(prisma, site.id, 'admin');
    const guard = await seedUser(prisma, site.id, 'guard');
    const adminToken = (await login(admin.phone)).body.accessToken;
    const g = (await login(guard.phone)).body;
    await http()
      .post(`/admin/devices/${g.deviceId}/revoke`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);
    await http().post('/auth/refresh').send({ refreshToken: g.refreshToken }).expect(401);
  });

  it('revoked device access token stops working at once', async () => {
    const { site } = await seedSite(prisma);
    const admin = await seedUser(prisma, site.id, 'admin');
    const guard = await seedUser(prisma, site.id, 'guard');
    const adminToken = (await login(admin.phone)).body.accessToken;
    const g = (await login(guard.phone)).body;
    await http().post(`/admin/devices/${g.deviceId}/revoke`).set('Authorization', `Bearer ${adminToken}`);
    await http().get('/test-admin').set('Authorization', `Bearer ${g.accessToken}`).expect(401);
  });

  it('@Roles blocks wrong role', async () => {
    const { site } = await seedSite(prisma);
    const guard = await seedUser(prisma, site.id, 'guard');
    const token = (await login(guard.phone)).body.accessToken;
    const r = await http().get('/test-admin').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('FORBIDDEN');
  });

  it('@Roles route without token is 401', async () => {
    await http().get('/test-admin').expect(401);
  });

  it('saves the device push token', async () => {
    const { site } = await seedSite(prisma);
    const user = await seedUser(prisma, site.id);
    const s = (await login(user.phone)).body;
    await http()
      .post('/devices/push-token')
      .set('Authorization', `Bearer ${s.accessToken}`)
      .send({ pushToken: 'ExponentPushToken[abc]' })
      .expect(204);
    const device = await prisma.device.findUniqueOrThrow({ where: { id: s.deviceId } });
    expect(device.pushToken).toBe('ExponentPushToken[abc]');
  });

  it('logout ends the refresh token', async () => {
    const { site } = await seedSite(prisma);
    const user = await seedUser(prisma, site.id);
    const s = (await login(user.phone)).body;
    await http().post('/auth/logout').send({ refreshToken: s.refreshToken }).expect(204);
    await http().post('/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401);
  });
});
