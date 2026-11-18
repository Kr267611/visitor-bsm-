import request from 'supertest';
import { ExpoPushProvider } from '../src/notifications/push.provider';
import { Msg91SmsProvider } from '../src/notifications/msg91-sms.provider';
import { StorageService } from '../src/storage/storage.service';
import { RetentionJob } from '../src/visits/retention.job';
import { seedBusiness, seedSite, seedUser, seedVisit } from './factories';
import { createTestApp, resetData, TestContext, tokenFor } from './setup';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(50, 1)]);
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('review fixes', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(() => resetData(ctx));
  afterAll(() => ctx.app.close());

  const otpOf = (phone: string) => ctx.sms.sent.filter((m) => m.to === phone).at(-1)!.text.match(/\d{6}/)![0];

  async function login(phone: string) {
    await http().post('/auth/otp/request').send({ phone }).expect(204);
    const res = await http().post('/auth/otp/verify').send({ phone, otp: otpOf(phone), deviceName: 'p' }).expect(200);
    return res.body as { accessToken: string; refreshToken: string; deviceId: string };
  }

  describe('refresh token grace', () => {
    it('old token still works for 30s, so a lost response does not log out', async () => {
      const { site } = await seedSite(ctx.prisma);
      const user = await seedUser(ctx.prisma, site.id);
      const first = await login(user.phone);
      await http().post('/auth/refresh').send({ refreshToken: first.refreshToken }).expect(200);
      const again = await http().post('/auth/refresh').send({ refreshToken: first.refreshToken });
      expect(again.status).toBe(200);
      expect(again.body.accessToken).toBeTruthy();
    });

    it('old token refused after 30s', async () => {
      const { site } = await seedSite(ctx.prisma);
      const user = await seedUser(ctx.prisma, site.id);
      const first = await login(user.phone);
      await http().post('/auth/refresh').send({ refreshToken: first.refreshToken }).expect(200);
      await ctx.prisma.refreshToken.updateMany({
        where: { revokedAt: { not: null } },
        data: { revokedAt: new Date(Date.now() - 31_000) },
      });
      await http().post('/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401);
    });
  });

  describe('SMS gateway down during OTP', () => {
    it('clear 503, failed sends do not lock the number', async () => {
      const { site } = await seedSite(ctx.prisma);
      const guard = await seedUser(ctx.prisma, site.id, 'guard');
      const token = await tokenFor(ctx, guard.id);
      ctx.sms.failing = true;
      for (let i = 0; i < 5; i++) {
        const res = await http().post('/gate/walk-ins/otp').set(auth(token)).send({ phone: '9876543210' });
        expect(res.status).toBe(503);
        expect(res.body.error).toBe('SMS_UNAVAILABLE');
      }
      ctx.sms.failing = false;
      await http().post('/gate/walk-ins/otp').set(auth(token)).send({ phone: '9876543210' }).expect(204);
    });
  });

  describe('OTP guessing', () => {
    it('daily failure cap blocks even the correct OTP', async () => {
      const { site } = await seedSite(ctx.prisma);
      const user = await seedUser(ctx.prisma, site.id);
      await http().post('/auth/otp/request').send({ phone: user.phone }).expect(204);
      await ctx.redis.client.set(`otp-fail:LOGIN_OTP:${user.phone}`, '30', 'EX', 86_400);
      const res = await http().post('/auth/otp/verify').send({ phone: user.phone, otp: otpOf(user.phone), deviceName: 'p' });
      expect(res.status).toBe(401);
    });

    it('wrong guesses count toward the daily cap', async () => {
      const { site } = await seedSite(ctx.prisma);
      const user = await seedUser(ctx.prisma, site.id);
      await http().post('/auth/otp/request').send({ phone: user.phone }).expect(204);
      const wrong = otpOf(user.phone) === '000000' ? '111111' : '000000';
      await http().post('/auth/otp/verify').send({ phone: user.phone, otp: wrong, deviceName: 'p' }).expect(401);
      expect(await ctx.redis.client.get(`otp-fail:LOGIN_OTP:${user.phone}`)).toBe('1');
    });

    it('login routes are rate limited per IP', async () => {
      process.env.AUTH_RATE_LIMIT = '3';
      try {
        const codes: number[] = [];
        for (let i = 0; i < 5; i++) {
          const r = await http().post('/auth/otp/request').set('X-Forwarded-For', '203.0.113.20').send({ phone: `+91900000000${i}` });
          codes.push(r.status);
        }
        expect(codes).toEqual([204, 204, 204, 429, 429]);
      } finally {
        process.env.AUTH_RATE_LIMIT = '100000';
      }
    });
  });

  describe('devices across sites', () => {
    it('security sees and revokes only own site devices, admin sees all', async () => {
      const a = await seedSite(ctx.prisma, 'A');
      const b = await seedSite(ctx.prisma, 'B');
      const secA = await seedUser(ctx.prisma, a.site.id, 'security');
      const guardB = await seedUser(ctx.prisma, b.site.id, 'guard');
      const admin = await seedUser(ctx.prisma, a.site.id, 'admin');
      const deviceB = await ctx.prisma.device.create({ data: { userId: guardB.id, name: 'B phone' } });
      const tokenA = await tokenFor(ctx, secA.id);

      const list = await http().get('/admin/devices').set(auth(tokenA)).expect(200);
      expect(list.body.map((d: { id: string }) => d.id)).not.toContain(deviceB.id);
      await http().post(`/admin/devices/${deviceB.id}/revoke`).set(auth(tokenA)).expect(404);
      expect((await ctx.prisma.device.findUniqueOrThrow({ where: { id: deviceB.id } })).revokedAt).toBeNull();

      const all = await http().get('/admin/devices').set(auth(await tokenFor(ctx, admin.id))).expect(200);
      expect(all.body.map((d: { id: string }) => d.id)).toContain(deviceB.id);
    });
  });

  describe('stored visitor data before registration', () => {
    async function inviteExisting() {
      const { site } = await seedSite(ctx.prisma);
      const host = await seedUser(ctx.prisma, site.id);
      await ctx.prisma.visitor.create({
        data: { businessId: site.businessId, phone: '+919876543210', name: 'Real Stored Name', company: 'Secret Co', photoKey: 'visitors/old/p.jpg' },
      });
      const token = await tokenFor(ctx, host.id);
      const res = await http()
        .post('/visits')
        .set(auth(token))
        .send({
          visitorName: 'Typed By Host',
          visitorPhone: '9876543210',
          validFrom: new Date(Date.now() + 3_600_000).toISOString(),
          validTo: new Date(Date.now() + 7_200_000).toISOString(),
          purpose: 'Meeting',
        })
        .expect(201);
      return { token, id: res.body.id as string };
    }

    it('host sees only what they typed until the visitor registers', async () => {
      const { token, id } = await inviteExisting();
      const list = await http().get('/visits').set(auth(token)).expect(200);
      expect(list.body[0]).toMatchObject({ visitorName: 'Typed By Host', company: null, photoUrl: null });
      const one = await http().get(`/visits/${id}`).set(auth(token)).expect(200);
      expect(one.body).toMatchObject({ visitorName: 'Typed By Host', company: null, photoUrl: null });
    });

    it('public invite page also shows only the typed name', async () => {
      const { id } = await inviteExisting();
      const box = await ctx.prisma.outbox.findFirstOrThrow({ where: { visitId: id, template: 'INVITE_LINK' } });
      const link = (box.vars as { link: string }).link.split('/v/')[1];
      const res = await http().get(`/public/invites/${link}`).expect(200);
      expect(res.body.visitorName).toBe('Typed By Host');
      expect(JSON.stringify(res.body)).not.toContain('Secret Co');
    });
  });

  describe('logout and push tokens', () => {
    it('logout stops pushes to that phone', async () => {
      const { site } = await seedSite(ctx.prisma);
      const user = await seedUser(ctx.prisma, site.id);
      const s = await login(user.phone);
      await http().post('/devices/push-token').set(auth(s.accessToken)).send({ pushToken: 'tok' }).expect(204);
      await http().post('/auth/logout').send({ refreshToken: s.refreshToken }).expect(204);
      const device = await ctx.prisma.device.findUniqueOrThrow({ where: { id: s.deviceId } });
      expect(device.pushToken).toBeNull();
      expect(device.revokedAt).toBeTruthy();
    });

    it('same phone token moves to the newest login only', async () => {
      const { site } = await seedSite(ctx.prisma);
      const a = await seedUser(ctx.prisma, site.id);
      const b = await seedUser(ctx.prisma, site.id);
      const sa = await login(a.phone);
      const sb = await login(b.phone);
      await http().post('/devices/push-token').set(auth(sa.accessToken)).send({ pushToken: 'same' }).expect(204);
      await http().post('/devices/push-token').set(auth(sb.accessToken)).send({ pushToken: 'same' }).expect(204);
      const rows = await ctx.prisma.device.findMany({ where: { pushToken: 'same' } });
      expect(rows.map((r) => r.id)).toEqual([sb.deviceId]);
    });
  });

  describe('retention', () => {
    it('removes photo and ID details after delete_after, keeps the visit record', async () => {
      const storage = ctx.app.get(StorageService);
      await storage.put('visitors/x/old.jpg', JPEG, 'image/jpeg');
      await storage.put('visitors/x/new.jpg', JPEG, 'image/jpeg');
      const biz = await seedBusiness(ctx.prisma);
      const oldOne = await ctx.prisma.visitor.create({
        data: {
          businessId: biz.id,
          phone: '+919000000011',
          name: 'Old',
          photoKey: 'visitors/x/old.jpg',
          idType: 'PAN',
          idLast4: '1234',
          deleteAfter: new Date(Date.now() - 1000),
        },
      });
      const fresh = await ctx.prisma.visitor.create({
        data: {
          businessId: biz.id,
          phone: '+919000000012',
          name: 'New',
          photoKey: 'visitors/x/new.jpg',
          idLast4: '9999',
          deleteAfter: new Date(Date.now() + 86_400_000),
        },
      });
      expect(await ctx.app.get(RetentionJob).run()).toBe(1);
      const a = await ctx.prisma.visitor.findUniqueOrThrow({ where: { id: oldOne.id } });
      expect(a).toMatchObject({ photoKey: null, idType: null, idLast4: null, deleteAfter: null });
      expect(await storage.exists('visitors/x/old.jpg')).toBe(false);
      const b = await ctx.prisma.visitor.findUniqueOrThrow({ where: { id: fresh.id } });
      expect(b.idLast4).toBe('9999');
      expect(await storage.exists('visitors/x/new.jpg')).toBe(true);
    });
  });

  describe('dead invite links', () => {
    it.each(['CANCELLED', 'CHECKED_OUT', 'EXPIRED'] as const)('%s link cannot overwrite the visitor', async (status) => {
      const { site } = await seedSite(ctx.prisma);
      const host = await seedUser(ctx.prisma, site.id, 'employee');
      const token = await tokenFor(ctx, host.id);
      const made = await http()
        .post('/visits')
        .set(auth(token))
        .send({
          visitorName: 'Rahul Verma',
          visitorPhone: '9876543210',
          validFrom: new Date(Date.now() + 3_600_000).toISOString(),
          validTo: new Date(Date.now() + 7_200_000).toISOString(),
          purpose: 'x',
        })
        .expect(201);
      const box = await ctx.prisma.outbox.findFirstOrThrow({ where: { visitId: made.body.id } });
      const link = (box.vars as { link: string }).link.split('/v/')[1];
      const photo = await http()
        .post(`/public/invites/${link}/photo`)
        .attach('photo', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .expect(201);
      await ctx.prisma.visit.update({ where: { id: made.body.id }, data: { status } });
      const res = await http()
        .post(`/public/invites/${link}/register`)
        .send({ name: 'Hacked Name', photoKey: photo.body.key, consent: true });
      expect(res.status).toBe(409);
      expect((await ctx.prisma.visitor.findFirstOrThrow()).name).toBe('Rahul Verma');
    });
  });

  describe('delivery failure is visible', () => {
    it('GET /visits/:id says when an SMS finally failed', async () => {
      const { site } = await seedSite(ctx.prisma);
      const host = await seedUser(ctx.prisma, site.id);
      const visit = await seedVisit(ctx.prisma, { premisesId: site.id, hostId: host.id, status: 'INVITED' });
      const token = await tokenFor(ctx, host.id);
      const before = await http().get(`/visits/${visit.id}`).set(auth(token)).expect(200);
      expect(before.body.deliveryFailed).toBe(false);
      await ctx.prisma.outbox.create({
        data: { visitId: visit.id, channel: 'SMS', template: 'INVITE_LINK', recipient: 'x', vars: {}, status: 'FAILED' },
      });
      const after = await http().get(`/visits/${visit.id}`).set(auth(token)).expect(200);
      expect(after.body.deliveryFailed).toBe(true);
    });
  });

  describe('gateway timeouts', () => {
    it('SMS request carries a timeout signal', async () => {
      let signal: AbortSignal | null | undefined;
      const fake = (async (_u: string, init: RequestInit) => {
        signal = init.signal;
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch;
      await new Msg91SmsProvider('k', 'S', fake).send('+919876543210', 'x');
      expect(signal).toBeInstanceOf(AbortSignal);
    });

    it('push request carries a timeout signal', async () => {
      let signal: AbortSignal | null | undefined;
      const fake = (async (_u: string, init: RequestInit) => {
        signal = init.signal;
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch;
      await new ExpoPushProvider(fake).send({ token: 't', body: 'b', data: {} });
      expect(signal).toBeInstanceOf(AbortSignal);
    });
  });
});
