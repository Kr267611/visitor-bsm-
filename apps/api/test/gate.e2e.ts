import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { OutboxWorker } from '../src/notifications/outbox.worker';
import { PassService } from '../src/passes/pass.service';
import { seedSite, seedUser, seedVisit } from './factories';
import { createTestApp, resetData, TestContext, tokenFor } from './setup';

const MIN = 60_000;

describe('gate', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(() => resetData(ctx));
  afterAll(() => ctx.app.close());

  async function world(visitOver: Parameters<typeof seedVisit>[1] = {}) {
    const { site, gate } = await seedSite(ctx.prisma);
    const host = await seedUser(ctx.prisma, site.id, 'employee', { name: 'Anita Singh' });
    const guard = await seedUser(ctx.prisma, site.id, 'guard');
    const visit = await seedVisit(ctx.prisma, { siteId: site.id, hostId: host.id, ...visitOver });
    const qr = ctx.app.get(PassService).sign({
      visitId: visit.id,
      siteId: site.id,
      validFrom: visit.validFrom,
      validTo: visit.validTo,
    });
    return { site, gate, host, guard, visit, qr, token: await tokenFor(ctx, guard.id) };
  }

  const scan = (token: string, body: object) =>
    http().post('/gate/scan').set('Authorization', `Bearer ${token}`).send({ clientEventId: randomUUID(), ...body });

  it('valid QR IN => CHECKED_IN, photoUrl present, host notified', async () => {
    const w = await world();
    await ctx.prisma.visitor.updateMany({ data: { photoKey: 'visitors/x/y.jpg', company: 'ACME' } });
    const res = await scan(w.token, { qr: w.qr, gateId: w.gate.id, mode: 'IN' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      result: 'CHECKED_IN',
      visitId: w.visit.id,
      visitor: { name: 'Rahul Verma', company: 'ACME' },
      host: 'Anita Singh',
    });
    expect(res.body.visitor.photoUrl).toMatch(/^http:\/\/api\.test\/photos\//);
    const row = await ctx.prisma.visit.findUniqueOrThrow({ where: { id: w.visit.id } });
    expect(row.status).toBe('CHECKED_IN');
    expect(row.inGateId).toBe(w.gate.id);
    expect(row.checkedInAt).toBeTruthy();
    const box = await ctx.prisma.outbox.findFirstOrThrow({ where: { visitId: w.visit.id } });
    expect(box.template).toBe('VISITOR_ARRIVED');
    expect(box.recipient).toBe(w.host.id);
    expect(box.vars).toEqual({ visitorName: 'Rahul Verma', gateName: 'Main Gate 1' });
  });

  it('garbage QR 422 INVALID_PASS', async () => {
    const w = await world();
    const res = await scan(w.token, { qr: 'garbage', gateId: w.gate.id, mode: 'IN' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('INVALID_PASS');
  });

  it('pass of other site at this gate 422 WRONG_SITE', async () => {
    const w = await world();
    const other = await seedSite(ctx.prisma, 'Plant 2');
    const otherGuard = await seedUser(ctx.prisma, other.site.id, 'guard');
    const res = await scan(await tokenFor(ctx, otherGuard.id), { qr: w.qr, gateId: other.gate.id, mode: 'IN' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('WRONG_SITE');
  });

  it('guard of other site 403', async () => {
    const w = await world();
    const other = await seedSite(ctx.prisma, 'Plant 2');
    const otherGuard = await seedUser(ctx.prisma, other.site.id, 'guard');
    const res = await scan(await tokenFor(ctx, otherGuard.id), { qr: w.qr, gateId: w.gate.id, mode: 'IN' });
    expect(res.status).toBe(403);
  });

  it('employee cannot scan', async () => {
    const w = await world();
    const res = await scan(await tokenFor(ctx, w.host.id), { qr: w.qr, gateId: w.gate.id, mode: 'IN' });
    expect(res.status).toBe(403);
  });

  it('60 min early 422 PASS_NOT_YET_VALID; 20 min early works', async () => {
    const early = await world({ validFrom: new Date(Date.now() + 60 * MIN), validTo: new Date(Date.now() + 120 * MIN) });
    const res = await scan(early.token, { qr: early.qr, gateId: early.gate.id, mode: 'IN' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('PASS_NOT_YET_VALID');

    await resetData(ctx);
    const ok = await world({ validFrom: new Date(Date.now() + 20 * MIN), validTo: new Date(Date.now() + 120 * MIN) });
    expect((await scan(ok.token, { qr: ok.qr, gateId: ok.gate.id, mode: 'IN' })).status).toBe(200);
  });

  it('expired 422 PASS_EXPIRED with date in IST in message', async () => {
    // 4 Nov 20:00 UTC = 5 Nov 01:30 IST
    const w = await world({
      validFrom: new Date('2026-11-04T18:00:00Z'),
      validTo: new Date('2026-11-04T20:00:00Z'),
    });
    const res = await scan(w.token, { qr: w.qr, gateId: w.gate.id, mode: 'IN' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('PASS_EXPIRED');
    expect(res.body.message).toBe('Yeh pass 5 Nov ke liye tha');
  });

  it('visit already marked EXPIRED also says PASS_EXPIRED', async () => {
    const w = await world({ status: 'EXPIRED', validFrom: new Date('2026-11-04T04:00:00Z'), validTo: new Date('2026-11-04T07:00:00Z') });
    const res = await scan(w.token, { qr: w.qr, gateId: w.gate.id, mode: 'IN' });
    expect(res.body.error).toBe('PASS_EXPIRED');
  });

  it('second IN scan new eventId 409 ALREADY_CHECKED_IN with at and gate', async () => {
    const w = await world();
    await scan(w.token, { qr: w.qr, gateId: w.gate.id, mode: 'IN' }).expect(200);
    const res = await scan(w.token, { qr: w.qr, gateId: w.gate.id, mode: 'IN' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ALREADY_CHECKED_IN');
    expect(res.body.gate).toBe('Main Gate 1');
    expect(new Date(res.body.at).getTime()).toBeGreaterThan(Date.now() - MIN);
  });

  it('same clientEventId replay returns original 200, one event', async () => {
    const w = await world();
    const clientEventId = randomUUID();
    const first = await scan(w.token, { qr: w.qr, gateId: w.gate.id, mode: 'IN', clientEventId }).expect(200);
    const again = await scan(w.token, { qr: w.qr, gateId: w.gate.id, mode: 'IN', clientEventId }).expect(200);
    expect(again.body.result).toBe('CHECKED_IN');
    expect(again.body.visitId).toBe(first.body.visitId);
    expect(await ctx.prisma.visitEvent.count({ where: { visitId: w.visit.id, type: 'CHECK_IN' } })).toBe(1);
    expect(await ctx.prisma.outbox.count({ where: { visitId: w.visit.id } })).toBe(1);
  });

  it('replay of a check-in stays CHECKED_IN result after checkout', async () => {
    const w = await world();
    const clientEventId = randomUUID();
    await scan(w.token, { qr: w.qr, gateId: w.gate.id, mode: 'IN', clientEventId }).expect(200);
    await scan(w.token, { qr: w.qr, gateId: w.gate.id, mode: 'OUT' }).expect(200);
    const again = await scan(w.token, { qr: w.qr, gateId: w.gate.id, mode: 'IN', clientEventId }).expect(200);
    expect(again.body.result).toBe('CHECKED_IN');
  });

  it('same clientEventId in parallel: both 200, one event', async () => {
    const w = await world();
    const clientEventId = randomUUID();
    const [a, b] = await Promise.all([
      scan(w.token, { qr: w.qr, gateId: w.gate.id, mode: 'IN', clientEventId }),
      scan(w.token, { qr: w.qr, gateId: w.gate.id, mode: 'IN', clientEventId }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await ctx.prisma.visitEvent.count({ where: { visitId: w.visit.id, type: 'CHECK_IN' } })).toBe(1);
  });

  it('two gates parallel: one 200, one 409, one event', async () => {
    const w = await world();
    const gate2 = await ctx.prisma.gate.create({ data: { siteId: w.site.id, name: 'Gate 2' } });
    const [a, b] = await Promise.all([
      scan(w.token, { qr: w.qr, gateId: w.gate.id, mode: 'IN' }),
      scan(w.token, { qr: w.qr, gateId: gate2.id, mode: 'IN' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error).toBe('ALREADY_CHECKED_IN');
    expect(await ctx.prisma.visitEvent.count({ where: { visitId: w.visit.id, type: 'CHECK_IN' } })).toBe(1);
  });

  it('OUT after validTo still checks out', async () => {
    const w = await world({ status: 'CHECKED_IN', validFrom: new Date(Date.now() - 300 * MIN), validTo: new Date(Date.now() - 60 * MIN) });
    const res = await scan(w.token, { qr: w.qr, gateId: w.gate.id, mode: 'OUT' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('CHECKED_OUT');
    const row = await ctx.prisma.visit.findUniqueOrThrow({ where: { id: w.visit.id } });
    expect(row.outGateId).toBe(w.gate.id);
    expect(row.checkedOutAt).toBeTruthy();
  });

  it('OUT on not-checked-in 409 NOT_CHECKED_IN', async () => {
    const w = await world();
    const res = await scan(w.token, { qr: w.qr, gateId: w.gate.id, mode: 'OUT' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NOT_CHECKED_IN');
  });

  it('second OUT scan 409 NOT_CHECKED_IN', async () => {
    const w = await world({ status: 'CHECKED_IN' });
    await scan(w.token, { qr: w.qr, gateId: w.gate.id, mode: 'OUT' }).expect(200);
    const res = await scan(w.token, { qr: w.qr, gateId: w.gate.id, mode: 'OUT' });
    expect(res.body.error).toBe('NOT_CHECKED_IN');
  });

  it('REJECTED visit QR 409 INVALID_TRANSITION', async () => {
    const w = await world({ status: 'REJECTED' });
    const res = await scan(w.token, { qr: w.qr, gateId: w.gate.id, mode: 'IN' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'INVALID_TRANSITION', status: 'REJECTED' });
  });

  it('cancelled visit pass stops working', async () => {
    const w = await world({ status: 'CANCELLED' });
    const res = await scan(w.token, { qr: w.qr, gateId: w.gate.id, mode: 'IN' });
    expect(res.body).toMatchObject({ error: 'INVALID_TRANSITION', status: 'CANCELLED' });
  });

  it('invalid mode rejected', async () => {
    const w = await world();
    await scan(w.token, { qr: w.qr, gateId: w.gate.id, mode: 'SIDEWAYS' }).expect(422);
  });

  it('check-in works with SMS provider failing', async () => {
    const w = await world();
    ctx.sms.failing = true;
    await scan(w.token, { qr: w.qr, gateId: w.gate.id, mode: 'IN' }).expect(200);
    await ctx.app.get(OutboxWorker).tick();
    expect((await ctx.prisma.visit.findUniqueOrThrow({ where: { id: w.visit.id } })).status).toBe('CHECKED_IN');
    expect((await ctx.prisma.outbox.findFirstOrThrow({ where: { visitId: w.visit.id } })).attempts).toBe(1);
  });

  it('manual check-in records actor and gate in event', async () => {
    const w = await world();
    const res = await http()
      .post(`/visits/${w.visit.id}/check-in`)
      .set('Authorization', `Bearer ${w.token}`)
      .send({ gateId: w.gate.id, clientEventId: randomUUID() });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('CHECKED_IN');
    const event = await ctx.prisma.visitEvent.findFirstOrThrow({ where: { visitId: w.visit.id, type: 'CHECK_IN' } });
    expect(event.actorId).toBe(w.guard.id);
    expect(event.gateId).toBe(w.gate.id);
    expect(event.meta).toEqual({ method: 'manual' });
  });

  it('manual check-out works without QR, even after validTo', async () => {
    const w = await world({ status: 'CHECKED_IN', validFrom: new Date(Date.now() - 300 * MIN), validTo: new Date(Date.now() - 60 * MIN) });
    const res = await http()
      .post(`/visits/${w.visit.id}/check-out`)
      .set('Authorization', `Bearer ${w.token}`)
      .send({ gateId: w.gate.id, clientEventId: randomUUID() });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('CHECKED_OUT');
  });

  it('manual check-in on visit of other site 403', async () => {
    const w = await world();
    const other = await seedSite(ctx.prisma, 'Plant 2');
    const otherGuard = await seedUser(ctx.prisma, other.site.id, 'guard');
    await http()
      .post(`/visits/${w.visit.id}/check-in`)
      .set('Authorization', `Bearer ${await tokenFor(ctx, otherGuard.id)}`)
      .send({ gateId: other.gate.id, clientEventId: randomUUID() })
      .expect(403);
  });
});
