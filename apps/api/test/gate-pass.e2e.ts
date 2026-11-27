import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PassService } from '../src/passes/pass.service';
import { seedSite, seedUser, seedVisit } from './factories';
import { createTestApp, resetData, TestContext, tokenFor } from './setup';

describe('gate pass', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(() => resetData(ctx));
  afterAll(() => ctx.app.close());

  async function world() {
    const { site, gate } = await seedSite(ctx.prisma, 'Head Office');
    const host = await seedUser(ctx.prisma, site.id, 'employee', { name: 'Anita Singh' });
    const guard = await seedUser(ctx.prisma, site.id, 'guard', { name: 'Ramesh Guard' });
    const visit = await seedVisit(ctx.prisma, { premisesId: site.id, hostId: host.id });
    const qr = ctx.app.get(PassService).sign({ visitId: visit.id, premisesId: site.id, validFrom: visit.validFrom, validTo: visit.validTo });
    const auth = { Authorization: `Bearer ${await tokenFor(ctx, guard.id)}` };
    return { site, gate, host, guard, visit, qr, auth };
  }

  const scan = (auth: Record<string, string>, body: object) => http().post('/gate/scan').set(auth).send({ clientEventId: randomUUID(), ...body });

  it('check-out numbers a gate pass and keeps what the visitor carried', async () => {
    const w = await world();
    await scan(w.auth, { qr: w.qr, gateId: w.gate.id, mode: 'IN' }).expect(200);
    const out = await scan(w.auth, { qr: w.qr, gateId: w.gate.id, mode: 'OUT', itemsOut: '2 sample cones' }).expect(200);
    expect(out.body.result).toBe('CHECKED_OUT');
    expect(out.body.gatePassNo).toMatch(/^GP-\d{4}-\d{5}$/);

    const pass = await http().get(`/visits/${w.visit.id}/gate-pass`).set(w.auth).expect(200);
    expect(pass.body).toMatchObject({
      gatePassNo: out.body.gatePassNo,
      status: 'CHECKED_OUT',
      premisesName: 'Head Office',
      visitorName: 'Rahul Verma',
      hostName: 'Anita Singh',
      purpose: 'Meeting',
      inGate: 'Main Gate 1',
      outGate: 'Main Gate 1',
      itemsOut: '2 sample cones',
      checkedOutBy: 'Ramesh Guard',
    });
    expect(new Date(pass.body.outAt).getTime()).toBeGreaterThanOrEqual(new Date(pass.body.inAt).getTime());
  });

  it('manual check-out from the desk also gets the next number', async () => {
    const w = await world();
    const second = await seedVisit(ctx.prisma, { premisesId: w.site.id, hostId: w.host.id });
    const nos: string[] = [];
    for (const v of [w.visit, second]) {
      await http().post(`/visits/${v.id}/check-in`).set(w.auth).send({ gateId: w.gate.id, clientEventId: randomUUID() }).expect(200);
      const res = await http().post(`/visits/${v.id}/check-out`).set(w.auth).send({ gateId: w.gate.id, clientEventId: randomUUID() }).expect(200);
      nos.push(res.body.gatePassNo);
    }
    const [a, b] = nos.map((n) => Number(n.slice(-5)));
    expect(b).toBe(a + 1);
    expect((await ctx.prisma.visit.findUniqueOrThrow({ where: { id: second.id } })).itemsOut).toBeNull();
  });

  it('a retried check-out does not make a second gate pass', async () => {
    const w = await world();
    await scan(w.auth, { qr: w.qr, gateId: w.gate.id, mode: 'IN' }).expect(200);
    const id = randomUUID();
    const first = await scan(w.auth, { qr: w.qr, gateId: w.gate.id, mode: 'OUT', clientEventId: id }).expect(200);
    const again = await scan(w.auth, { qr: w.qr, gateId: w.gate.id, mode: 'OUT', clientEventId: id }).expect(200);
    expect(again.body.gatePassNo).toBe(first.body.gatePassNo);
  });

  it('register lists visits that came in on the chosen India dates, with search', async () => {
    const w = await world();
    const other = await seedVisit(ctx.prisma, { premisesId: w.site.id, hostId: w.host.id });
    await ctx.prisma.visit.update({ where: { id: w.visit.id }, data: { status: 'CHECKED_OUT', checkedInAt: new Date('2026-11-20T04:00:00Z'), checkedOutAt: new Date('2026-11-20T05:30:00Z'), gatePassNo: 'GP-2026-00001' } });
    // 21 Nov 01:00 in India, though still 20 Nov in UTC.
    await ctx.prisma.visit.update({ where: { id: other.id }, data: { status: 'CHECKED_IN', checkedInAt: new Date('2026-11-20T19:30:00Z') } });
    await ctx.prisma.visitor.update({ where: { id: other.visitorId }, data: { name: 'Suresh Kumar' } });

    const day = await http().get('/gate-passes?from=2026-11-20&to=2026-11-20').set(w.auth).expect(200);
    expect(day.body.map((p: { visitId: string }) => p.visitId)).toEqual([w.visit.id]);
    const both = await http().get('/gate-passes?from=2026-11-20&to=2026-11-21').set(w.auth).expect(200);
    expect(both.body.map((p: { visitId: string }) => p.visitId)).toEqual([other.id, w.visit.id]);
    const found = await http().get('/gate-passes?from=2026-11-20&to=2026-11-21&q=sures').set(w.auth).expect(200);
    expect(found.body.map((p: { visitorName: string }) => p.visitorName)).toEqual(['Suresh Kumar']);
    await http().get('/gate-passes?from=2026-11-21&to=2026-11-20').set(w.auth).expect(422);
    await http().get('/gate-passes?from=bad&to=2026-11-20').set(w.auth).expect(422);
  });

  it('another premises cannot see the gate pass; employees cannot open the register', async () => {
    const w = await world();
    const plant = await seedSite(ctx.prisma, 'Plant 2');
    const otherGuard = await seedUser(ctx.prisma, plant.site.id, 'guard');
    await http().get(`/visits/${w.visit.id}/gate-pass`).set('Authorization', `Bearer ${await tokenFor(ctx, otherGuard.id)}`).expect(404);
    await http().get('/gate-passes?from=2026-11-20&to=2026-11-20').set('Authorization', `Bearer ${await tokenFor(ctx, w.host.id)}`).expect(403);
  });

  it('the gate guard can approve or reject a request', async () => {
    const w = await world();
    const pending = await seedVisit(ctx.prisma, { premisesId: w.site.id, hostId: w.host.id, status: 'PENDING_APPROVAL' });
    const rejected = await seedVisit(ctx.prisma, { premisesId: w.site.id, hostId: w.host.id, status: 'PENDING_APPROVAL' });
    await http().post(`/visits/${pending.id}/approve`).set(w.auth).send({}).expect(200);
    await http().post(`/visits/${rejected.id}/reject`).set(w.auth).send({}).expect(200);
    expect((await ctx.prisma.visit.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('APPROVED');
    expect((await ctx.prisma.visit.findUniqueOrThrow({ where: { id: rejected.id } })).status).toBe('REJECTED');
  });
});
