import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { applyPlatformDefaults, assertRequiredEnv, configureApp } from '../src/configure-app';
import { seedSite, seedUser } from './factories';
import { createTestApp, resetData, TestContext, tokenFor } from './setup';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);

describe('smoke', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(() => resetData(ctx));
  afterAll(() => ctx.app.close());

  it('full visit: invite, register, scan in, host told, scan out, audit order', async () => {
    const { site, gate } = await seedSite(ctx.prisma);
    const host = await seedUser(ctx.prisma, site.id, 'employee', { name: 'Anita Singh' });
    const guard = await seedUser(ctx.prisma, site.id, 'guard');
    const hostToken = await tokenFor(ctx, host.id);
    const guardToken = await tokenFor(ctx, guard.id);

    const invite = await http()
      .post('/visits')
      .set('Authorization', `Bearer ${hostToken}`)
      .send({
        visitorName: 'Rahul Verma',
        visitorPhone: '9876543210',
        validFrom: new Date(Date.now() + 10 * 60_000).toISOString(),
        validTo: new Date(Date.now() + 3 * 3_600_000).toISOString(),
        purpose: 'Meeting',
      })
      .expect(201);
    const visitId = invite.body.id;

    const box = await ctx.prisma.outbox.findFirstOrThrow({ where: { visitId, template: 'INVITE_LINK' } });
    const token = (box.vars as { link: string }).link.split('/v/')[1];
    const photo = await http()
      .post(`/public/invites/${token}/photo`)
      .attach('photo', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(201);
    const reg = await http()
      .post(`/public/invites/${token}/register`)
      .send({ name: 'Rahul Verma', photoKey: photo.body.key, consent: true })
      .expect(201);

    const scan = (mode: 'IN' | 'OUT') =>
      http()
        .post('/gate/scan')
        .set('Authorization', `Bearer ${guardToken}`)
        .send({ qr: reg.body.pass, gateId: gate.id, mode, clientEventId: randomUUID() })
        .expect(200);

    expect((await scan('IN')).body.result).toBe('CHECKED_IN');
    const arrived = await ctx.prisma.outbox.findFirstOrThrow({ where: { visitId, template: 'VISITOR_ARRIVED' } });
    expect(arrived.recipient).toBe(host.id);
    expect((await scan('OUT')).body.result).toBe('CHECKED_OUT');

    const events = await ctx.prisma.visitEvent.findMany({ where: { visitId }, orderBy: { occurredAt: 'asc' } });
    expect(events.map((e) => e.type)).toEqual(['CREATED', 'REGISTER', 'CHECK_IN', 'CHECK_OUT']);
  });

  it('/health/details non-admin 403, admin gets queue numbers', async () => {
    const { site } = await seedSite(ctx.prisma);
    const guard = await seedUser(ctx.prisma, site.id, 'guard');
    const admin = await seedUser(ctx.prisma, site.id, 'admin');
    await http().get('/health/details').set('Authorization', `Bearer ${await tokenFor(ctx, guard.id)}`).expect(403);
    await ctx.prisma.outbox.create({
      data: {
        channel: 'SMS',
        template: 'PASS_READY',
        recipient: '+919876543210',
        vars: { link: 'l' },
        createdAt: new Date(Date.now() - 60_000),
      },
    });
    await ctx.prisma.outbox.create({
      data: { channel: 'SMS', template: 'PASS_READY', recipient: 'x', vars: { link: 'l' }, status: 'FAILED' },
    });
    const res = await http().get('/health/details').set('Authorization', `Bearer ${await tokenFor(ctx, admin.id)}`).expect(200);
    expect(res.body.outboxPending).toBe(1);
    expect(res.body.outboxFailed).toBe(1);
    expect(res.body.oldestPendingSec).toBeGreaterThanOrEqual(59);
    expect(typeof res.body.queueDepth).toBe('number');
  });

  it('security headers present, photos usable from web domain', async () => {
    const res = await http().get('/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  describe('CORS', () => {
    async function appWithOrigins(origins: string) {
      const before = process.env.CORS_ORIGINS;
      process.env.CORS_ORIGINS = origins;
      const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
      const app = mod.createNestApplication();
      configureApp(app);
      await app.listen(0);
      process.env.CORS_ORIGINS = before;
      return app;
    }

    it('allows listed domain, blocks others', async () => {
      const app = await appWithOrigins('https://visitor.example.com');
      const ok = await request(app.getHttpServer()).get('/health').set('Origin', 'https://visitor.example.com');
      expect(ok.headers['access-control-allow-origin']).toBe('https://visitor.example.com');
      const bad = await request(app.getHttpServer()).get('/health').set('Origin', 'https://evil.vercel.app');
      expect(bad.headers['access-control-allow-origin']).toBeUndefined();
      await app.close();
    });

    it('wildcards in the list are ignored', async () => {
      const app = await appWithOrigins('*,*.vercel.app');
      const res = await request(app.getHttpServer()).get('/health').set('Origin', 'https://evil.vercel.app');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      await app.close();
    });
  });

  describe('applyPlatformDefaults', () => {
    it('uses the Render URL when API_URL is not set', () => {
      const env: Record<string, string | undefined> = { RENDER_EXTERNAL_URL: 'https://api.onrender.com' };
      applyPlatformDefaults(env);
      expect(env.API_URL).toBe('https://api.onrender.com');
    });
    it('keeps API_URL when it is set', () => {
      const env: Record<string, string | undefined> = { API_URL: 'https://mine', RENDER_EXTERNAL_URL: 'https://other' };
      applyPlatformDefaults(env);
      expect(env.API_URL).toBe('https://mine');
    });
  });

  describe('assertRequiredEnv', () => {
    const good = {
      DATABASE_URL: 'x',
      REDIS_URL: 'x',
      JWT_SECRET: 'long-random-secret-value-long-random',
      QR_PRIVATE_KEY: 'x',
      QR_PUBLIC_KEY: 'x',
      PUBLIC_WEB_URL: 'x',
      API_URL: 'x',
      CONSENT_VERSION: 'v1',
    };
    it('passes when all set', () => {
      expect(() => assertRequiredEnv(good)).not.toThrow();
    });
    it('names the missing value', () => {
      expect(() => assertRequiredEnv({ ...good, QR_PUBLIC_KEY: undefined })).toThrow(/QR_PUBLIC_KEY/);
    });
    it('refuses the sample JWT secret', () => {
      expect(() => assertRequiredEnv({ ...good, JWT_SECRET: 'change-me' })).toThrow(/JWT_SECRET/);
    });
  });
});
