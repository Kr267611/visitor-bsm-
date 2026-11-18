import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { istDayRange } from '../src/common/time';
import { ExpiryJob } from '../src/visits/expiry.job';
import { VisitLifecycleService } from '../src/visits/visit-lifecycle.service';
import { seedBusiness, seedSite, seedUser, seedVisit } from './factories';
import { createTestApp, inTenant, resetData, TestContext, tokenFor } from './setup';

describe('live', () => {
  let ctx: TestContext;
  let url: string;
  const sockets: Socket[] = [];
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
    const { port } = ctx.app.getHttpServer().address() as AddressInfo;
    url = `http://localhost:${port}/live`;
  });
  beforeEach(() => resetData(ctx));
  afterEach(() => {
    sockets.splice(0).forEach((s) => s.disconnect());
  });
  afterAll(() => ctx.app.close());

  function connect(token?: string, premisesId?: string): Socket {
    const auth = { ...(token && { token }), ...(premisesId && { premisesId }) };
    const socket = io(url, { auth, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    return socket;
  }

  const once = <T>(socket: Socket, event: string) =>
    new Promise<T>((resolve) => socket.once(event, resolve as (v: unknown) => void));
  const ready = (socket: Socket) => once<void>(socket, 'ready');

  it('socket without token is disconnected', async () => {
    const socket = connect();
    await once(socket, 'disconnect');
    expect(socket.connected).toBe(false);
  });

  it('socket with bad token is disconnected', async () => {
    const socket = connect('not-a-token');
    await once(socket, 'disconnect');
    expect(socket.connected).toBe(false);
  });

  it('socket can pick an own premises, never another business premises', async () => {
    const a = await seedSite(ctx.prisma, 'A');
    const plant2 = await seedSite(ctx.prisma, 'Plant 2', a.business.id);
    const other = await seedSite(ctx.prisma, 'Other', (await seedBusiness(ctx.prisma)).id);
    const admin = await seedUser(ctx.prisma, a.site.id, 'admin');
    const token = await tokenFor(ctx, admin.id);

    const bad = connect(token, other.site.id);
    await once(bad, 'disconnect');
    expect(bad.connected).toBe(false);

    const good = connect(token, plant2.site.id);
    await ready(good);
    const seen = once<{ visitId: string }>(good, 'visit.updated');
    const visit = await seedVisit(ctx.prisma, { premisesId: plant2.site.id, hostId: admin.id });
    await inTenant(ctx, ctx.app.get(VisitLifecycleService)).apply({ visitId: visit.id, action: 'CHECK_IN', actorId: null });
    expect((await seen).visitId).toBe(visit.id);
  });

  it('guard cannot listen to an unassigned premises of own business', async () => {
    const a = await seedSite(ctx.prisma, 'A');
    const plant2 = await seedSite(ctx.prisma, 'Plant 2', a.business.id);
    const guard = await seedUser(ctx.prisma, a.site.id, 'guard');
    const socket = connect(await tokenFor(ctx, guard.id), plant2.site.id);
    await once(socket, 'disconnect');
    expect(socket.connected).toBe(false);
  });

  it('client gets visit.updated for own site, not other site', async () => {
    const a = await seedSite(ctx.prisma, 'A');
    const b = await seedSite(ctx.prisma, 'B');
    const guardA = await seedUser(ctx.prisma, a.site.id, 'guard');
    const guardB = await seedUser(ctx.prisma, b.site.id, 'guard');
    const socketA = connect(await tokenFor(ctx, guardA.id));
    const socketB = connect(await tokenFor(ctx, guardB.id));
    await Promise.all([ready(socketA), ready(socketB)]);

    const seenByB: unknown[] = [];
    socketB.on('visit.updated', (e) => seenByB.push(e));
    const visit = await seedVisit(ctx.prisma, { premisesId: a.site.id });
    const received = once<{ visitId: string; status: string }>(socketA, 'visit.updated');
    await inTenant(ctx, ctx.app.get(VisitLifecycleService)).apply({ visitId: visit.id, action: 'CHECK_IN', actorId: null });

    const e = await received;
    expect(e.visitId).toBe(visit.id);
    await new Promise((r) => setTimeout(r, 150));
    expect(seenByB).toHaveLength(0);
  });

  it('payload has only visitId and status', async () => {
    const { site } = await seedSite(ctx.prisma);
    const guard = await seedUser(ctx.prisma, site.id, 'guard');
    const socket = connect(await tokenFor(ctx, guard.id));
    await ready(socket);
    const visit = await seedVisit(ctx.prisma, { premisesId: site.id });
    const received = once<object>(socket, 'visit.updated');
    await inTenant(ctx, ctx.app.get(VisitLifecycleService)).apply({ visitId: visit.id, action: 'CHECK_IN', actorId: null });
    expect(await received).toEqual({ visitId: visit.id, status: 'CHECKED_IN' });
  });

  it('dashboard splits visits into the 4 lists', async () => {
    const { site } = await seedSite(ctx.prisma);
    const other = await seedSite(ctx.prisma, 'Other');
    const desk = await seedUser(ctx.prisma, site.id, 'reception');
    const host = await seedUser(ctx.prisma, site.id, 'employee', { name: 'Anita', phone: '+919811111111' });
    const on = { premisesId: site.id, hostId: host.id };
    const inside = await seedVisit(ctx.prisma, { ...on, status: 'CHECKED_IN' });
    const expected = await seedVisit(ctx.prisma, { ...on, status: 'APPROVED' });
    const invited = await seedVisit(ctx.prisma, { ...on, status: 'INVITED' });
    const pending = await seedVisit(ctx.prisma, { ...on, status: 'PENDING_APPROVAL' });
    const call = await seedVisit(ctx.prisma, { ...on, status: 'PENDING_APPROVAL' });
    await ctx.prisma.visit.update({ where: { id: call.id }, data: { receptionCallRequestedAt: new Date() } });
    await seedVisit(ctx.prisma, { ...on, status: 'CHECKED_OUT' });
    await seedVisit(ctx.prisma, { premisesId: other.site.id, status: 'CHECKED_IN' });

    const res = await http().get('/dashboard/live').set('Authorization', `Bearer ${await tokenFor(ctx, desk.id)}`).expect(200);
    const ids = (k: string) => res.body[k].map((v: { id: string }) => v.id).sort();
    expect(ids('inside')).toEqual([inside.id]);
    expect(ids('expected')).toEqual([expected.id, invited.id].sort());
    expect(ids('pending')).toEqual([pending.id]);
    expect(ids('needsCall')).toEqual([call.id]);
    expect(res.body.needsCall[0].hostPhone).toBe('+919811111111');
    expect(res.body.inside[0].visitorName).toBe('Rahul Verma');
  });

  it('employee cannot open dashboard', async () => {
    const { site } = await seedSite(ctx.prisma);
    const emp = await seedUser(ctx.prisma, site.id);
    await http().get('/dashboard/live').set('Authorization', `Bearer ${await tokenFor(ctx, emp.id)}`).expect(403);
  });

  it('istDayRange uses the IST day', () => {
    const { start, end } = istDayRange('2026-11-05');
    expect(start.toISOString()).toBe('2026-11-04T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-11-05T18:30:00.000Z');
    expect(istDayRange(undefined, new Date('2026-11-04T19:00:00Z')).start.toISOString()).toBe('2026-11-04T18:30:00.000Z');
  });

  it('expected uses IST day: 00:30 IST visit counted in that IST day', async () => {
    const { site } = await seedSite(ctx.prisma);
    const desk = await seedUser(ctx.prisma, site.id, 'reception');
    const on = { premisesId: site.id, status: 'APPROVED' as const };
    // 5 Nov 00:30 IST = 4 Nov 19:00 UTC
    const early = await seedVisit(ctx.prisma, {
      ...on,
      validFrom: new Date('2026-11-04T19:00:00Z'),
      validTo: new Date('2026-11-04T20:00:00Z'),
    });
    // 4 Nov 23:00 IST: pichla din
    await seedVisit(ctx.prisma, {
      ...on,
      validFrom: new Date('2026-11-04T17:00:00Z'),
      validTo: new Date('2026-11-04T17:30:00Z'),
    });
    // 6 Nov IST: agla din
    await seedVisit(ctx.prisma, {
      ...on,
      validFrom: new Date('2026-11-05T19:00:00Z'),
      validTo: new Date('2026-11-05T20:00:00Z'),
    });
    const now = new Date('2026-11-05T02:00:00Z');
    const data = await inTenant(ctx, ctx.app.get(DashboardService)).live(site.id, now);
    expect(data.expected.map((v) => v.id)).toEqual([early.id]);
    void desk;
  });

  it('needsCall only pending with reception_call_requested_at', async () => {
    const { site } = await seedSite(ctx.prisma);
    const v = await seedVisit(ctx.prisma, { premisesId: site.id, status: 'APPROVED' });
    await ctx.prisma.visit.update({ where: { id: v.id }, data: { receptionCallRequestedAt: new Date() } });
    const data = await inTenant(ctx, ctx.app.get(DashboardService)).live(site.id);
    expect(data.needsCall).toHaveLength(0);
  });

  it('expiry moves old INVITED/APPROVED/PENDING, leaves CHECKED_IN', async () => {
    const { site } = await seedSite(ctx.prisma);
    const past = { premisesId: site.id, validFrom: new Date(Date.now() - 7_200_000), validTo: new Date(Date.now() - 60_000) };
    const a = await seedVisit(ctx.prisma, { ...past, status: 'INVITED' });
    const b = await seedVisit(ctx.prisma, { ...past, status: 'APPROVED' });
    const c = await seedVisit(ctx.prisma, { ...past, status: 'PENDING_APPROVAL' });
    const stay = await seedVisit(ctx.prisma, { ...past, status: 'CHECKED_IN' });
    const future = await seedVisit(ctx.prisma, { premisesId: site.id, status: 'APPROVED' });

    expect(await ctx.app.get(ExpiryJob).run()).toBe(3);
    const status = async (id: string) => (await ctx.prisma.visit.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(a.id)).toBe('EXPIRED');
    expect(await status(b.id)).toBe('EXPIRED');
    expect(await status(c.id)).toBe('EXPIRED');
    expect(await status(stay.id)).toBe('CHECKED_IN');
    expect(await status(future.id)).toBe('APPROVED');
    expect(await ctx.prisma.visitEvent.count({ where: { visitId: a.id, type: 'EXPIRE' } })).toBe(1);
  });
});
