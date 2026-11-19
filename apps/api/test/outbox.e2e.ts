import { randomUUID } from 'node:crypto';
import { JobsService } from '../src/jobs/jobs.service';
import { Msg91SmsProvider } from '../src/notifications/msg91-sms.provider';
import { OutboxWorker } from '../src/notifications/outbox.worker';
import { VisitLifecycleService } from '../src/visits/visit-lifecycle.service';
import { seedUser, seedSite, seedVisit } from './factories';
import { createTestApp, resetData, TestContext } from './setup';

describe('outbox', () => {
  let ctx: TestContext;
  let worker: OutboxWorker;
  const T0 = new Date('2026-11-05T05:00:00Z');

  beforeAll(async () => {
    ctx = await createTestApp();
    worker = ctx.app.get(OutboxWorker);
  });
  beforeEach(() => resetData(ctx));
  afterAll(() => ctx.app.close());

  const addSms = () =>
    ctx.prisma.outbox.create({
      data: {
        channel: 'SMS',
        template: 'PASS_READY',
        recipient: '+919876543210',
        vars: { link: 'http://x/y' },
        nextRetryAt: new Date(T0.getTime() - 1000),
      },
    });

  it('sends pending SMS and marks SENT with provider id', async () => {
    const row = await addSms();
    expect(await worker.tick(T0)).toBe(1);
    expect(ctx.sms.sent).toEqual([{ to: '+919876543210', text: 'Your visitor pass is ready: http://x/y' }]);
    const after = await ctx.prisma.outbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe('SENT');
    expect(after.providerMsgId).toBeTruthy();
  });

  it('provider failure sets next_retry_at +30s, attempts 1', async () => {
    const row = await addSms();
    ctx.sms.failing = true;
    await worker.tick(T0);
    const after = await ctx.prisma.outbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe('PENDING');
    expect(after.attempts).toBe(1);
    expect(after.nextRetryAt.getTime()).toBe(T0.getTime() + 30_000);
    expect(after.lastError).toMatch(/down/);
  });

  it('backoff doubles on each failure', async () => {
    const row = await addSms();
    ctx.sms.failing = true;
    await worker.tick(T0);
    const t1 = new Date(T0.getTime() + 30_000);
    await worker.tick(t1);
    const after = await ctx.prisma.outbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.attempts).toBe(2);
    expect(after.nextRetryAt.getTime()).toBe(t1.getTime() + 60_000);
  });

  it('not retried before next_retry_at', async () => {
    await addSms();
    ctx.sms.failing = true;
    await worker.tick(T0);
    ctx.sms.failing = false;
    expect(await worker.tick(new Date(T0.getTime() + 29_000))).toBe(0);
    expect(ctx.sms.sent).toHaveLength(0);
  });

  it('12th failure marks FAILED, after hours of retries', async () => {
    const row = await addSms();
    ctx.sms.failing = true;
    let now = T0;
    for (let i = 0; i < 12; i++) {
      await worker.tick(now);
      now = new Date(now.getTime() + 3_600_000);
    }
    const after = await ctx.prisma.outbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe('FAILED');
    expect(after.attempts).toBe(12);
    expect(await worker.tick(new Date(now.getTime() + 3_600_000))).toBe(0);
  });

  it('backoff stops growing at 30 minutes', async () => {
    const row = await addSms();
    ctx.sms.failing = true;
    let now = T0;
    for (let i = 0; i < 8; i++) {
      await worker.tick(now);
      now = new Date(now.getTime() + 3_600_000);
    }
    const after = await ctx.prisma.outbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.nextRetryAt.getTime() - (now.getTime() - 3_600_000)).toBe(30 * 60_000);
  });

  it('two ticks in parallel send once', async () => {
    await addSms();
    await Promise.all([worker.tick(T0), worker.tick(T0)]);
    expect(ctx.sms.sent).toHaveLength(1);
  });

  it('push goes to active device with visit data', async () => {
    const { site } = await seedSite(ctx.prisma);
    const host = await seedUser(ctx.prisma, site.id);
    await ctx.prisma.device.create({ data: { userId: host.id, name: 'p', pushToken: 'tok-1' } });
    await ctx.prisma.device.create({
      data: { userId: host.id, name: 'old', pushToken: 'tok-old', revokedAt: new Date() },
    });
    const visit = await seedVisit(ctx.prisma, { premisesId: site.id, hostId: host.id });
    await ctx.prisma.outbox.create({
      data: {
        visitId: visit.id,
        channel: 'PUSH',
        template: 'VISITOR_ARRIVED',
        recipient: host.id,
        vars: { visitorName: 'Rahul', gateName: 'Main Gate 1' },
        nextRetryAt: new Date(T0.getTime() - 1000),
      },
    });
    await worker.tick(T0);
    expect(ctx.push.sent).toEqual([
      {
        token: 'tok-1',
        body: 'Rahul has arrived at Main Gate 1.',
        data: { visitId: visit.id, template: 'VISITOR_ARRIVED' },
      },
    ]);
    expect(ctx.sms.sent).toHaveLength(0);
  });

  it('push with no device falls back to SMS', async () => {
    const { site } = await seedSite(ctx.prisma);
    const host = await seedUser(ctx.prisma, site.id);
    await ctx.prisma.outbox.create({
      data: {
        channel: 'PUSH',
        template: 'VISITOR_ARRIVED',
        recipient: host.id,
        vars: { visitorName: 'Rahul', gateName: 'Gate' },
        nextRetryAt: new Date(T0.getTime() - 1000),
      },
    });
    await worker.tick(T0);
    expect(ctx.sms.sent).toEqual([{ to: host.phone, text: 'Rahul has arrived at Gate.' }]);
  });

  it('failed push falls back to SMS, approval text gets web link', async () => {
    const { site } = await seedSite(ctx.prisma);
    const host = await seedUser(ctx.prisma, site.id);
    await ctx.prisma.device.create({ data: { userId: host.id, name: 'p', pushToken: 'tok-1' } });
    const visit = await seedVisit(ctx.prisma, { premisesId: site.id, hostId: host.id });
    ctx.push.failing = true;
    await ctx.prisma.outbox.create({
      data: {
        visitId: visit.id,
        channel: 'PUSH',
        template: 'APPROVAL_REQUEST',
        recipient: host.id,
        vars: { visitorName: 'Rahul', company: 'ACME' },
        nextRetryAt: new Date(T0.getTime() - 1000),
      },
    });
    await worker.tick(T0);
    expect(ctx.sms.sent[0].text).toBe(
      `Rahul (ACME) is at the gate to meet you for a visit. Please approve or reject. http://web.test/my/visits/${visit.id}`,
    );
  });

  it('unknown template var throws at enqueue', async () => {
    const visit = await seedVisit(ctx.prisma);
    await expect(
      ctx.app.get(VisitLifecycleService).apply({
        visitId: visit.id,
        action: 'CHECK_IN',
        actorId: null,
        notify: [{ channel: 'PUSH', template: 'VISITOR_ARRIVED', recipient: 'x', vars: { visitorName: 'R' } }],
      }),
    ).rejects.toThrow(/gateName/);
    expect(await ctx.prisma.outbox.count()).toBe(0);
    expect((await ctx.prisma.visit.findUniqueOrThrow({ where: { id: visit.id } })).status).toBe('APPROVED');
  });

  it('background worker delivers without a manual tick', async () => {
    const jobs = ctx.app.get(JobsService);
    await ctx.prisma.outbox.create({
      data: { channel: 'SMS', template: 'PASS_READY', recipient: '+919876543211', vars: { link: 'l' } },
    });
    await jobs.startWorker();
    const deadline = Date.now() + 12_000;
    while (ctx.sms.sent.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }
    await jobs.stopWorker();
    expect(ctx.sms.sent.map((m) => m.to)).toEqual(['+919876543211']);
  }, 20_000);

  describe('Msg91SmsProvider', () => {
    it('posts to gateway and returns its id', async () => {
      const calls: { url: string; init: RequestInit }[] = [];
      const fake = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ type: 'success', message: randomUUID() }), { status: 200 });
      }) as unknown as typeof fetch;
      const provider = new Msg91SmsProvider('key-1', 'BSMVIS', fake);
      const res = await provider.send('+919876543210', 'Hello');
      expect(res.id).toBeTruthy();
      expect((calls[0].init.headers as Record<string, string>).authkey).toBe('key-1');
      const body = JSON.parse(calls[0].init.body as string);
      expect(body.sender).toBe('BSMVIS');
      expect(body.sms[0]).toEqual({ message: 'Hello', to: ['919876543210'] });
    });

    it('gateway error throws so outbox retries', async () => {
      const fake = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
      await expect(new Msg91SmsProvider('k', 'S', fake).send('+919876543210', 'x')).rejects.toThrow(/500/);
    });
  });
});
