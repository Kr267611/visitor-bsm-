import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ApprovalTimerProcessor } from '../src/approvals/approval-timer.processor';
import { JobsService } from '../src/jobs/jobs.service';
import { seedSite, seedUser, seedVisit } from './factories';
import { createTestApp, resetData, TestContext, tokenFor } from './setup';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);
const PHONE = '+919876543210';

describe('walk-in', () => {
  let ctx: TestContext;
  let timers: ApprovalTimerProcessor;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
    timers = ctx.app.get(ApprovalTimerProcessor);
  });
  beforeEach(() => resetData(ctx));
  afterAll(() => ctx.app.close());

  async function world() {
    const { site, gate } = await seedSite(ctx.prisma);
    const host = await seedUser(ctx.prisma, site.id, 'employee', { name: 'Anita Singh' });
    const guard = await seedUser(ctx.prisma, site.id, 'guard');
    return { site, gate, host, guard, token: await tokenFor(ctx, guard.id) };
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function otpFor(token: string, phone = PHONE) {
    await http().post('/gate/walk-ins/otp').set(auth(token)).send({ phone }).expect(204);
    return ctx.sms.sent.filter((m) => m.to === phone).at(-1)!.text.match(/\d{6}/)![0];
  }

  async function photoKey(token: string) {
    const res = await http()
      .post('/uploads/photo')
      .set(auth(token))
      .attach('photo', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(201);
    return res.body.key as string;
  }

  async function walkIn(w: Awaited<ReturnType<typeof world>>, over: object = {}) {
    const body = {
      phone: '98765 43210',
      otp: await otpFor(w.token),
      name: 'Rahul Verma',
      company: 'ACME',
      photoKey: await photoKey(w.token),
      hostId: w.host.id,
      purpose: 'Delivery',
      gateId: w.gate.id,
      consent: true,
      clientEventId: randomUUID(),
      ...over,
    };
    return http().post('/gate/walk-ins').set(auth(w.token)).send(body);
  }

  async function pendingVisit(w: Awaited<ReturnType<typeof world>>) {
    const res = await walkIn(w);
    expect(res.status).toBe(201);
    return res.body.visitId as string;
  }

  it('OTP SMS has the privacy link', async () => {
    const w = await world();
    await otpFor(w.token);
    expect(ctx.sms.sent.at(-1)!.text).toContain('http://web.test/privacy');
  });

  it('lookup returns known visitor, found:false for new', async () => {
    const w = await world();
    const none = await http().get('/gate/visitors/lookup?phone=9876543210').set(auth(w.token)).expect(200);
    expect(none.body).toEqual({ found: false });
    await ctx.prisma.visitor.create({ data: { phone: PHONE, name: 'Rahul Verma', company: 'ACME' } });
    const found = await http().get('/gate/visitors/lookup?phone=98765-43210').set(auth(w.token)).expect(200);
    expect(found.body).toEqual({ found: true, name: 'Rahul Verma', company: 'ACME', photoUrl: null });
  });

  it('walk-in with wrong OTP 401, no visit created', async () => {
    const w = await world();
    const res = await walkIn(w, { otp: '000000' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('INVALID_OTP');
    expect(await ctx.prisma.visit.count()).toBe(0);
  });

  it('login OTP does not work for walk-in', async () => {
    const w = await world();
    await http().post('/auth/otp/request').send({ phone: w.guard.phone }).expect(204);
    const loginOtp = ctx.sms.sent.at(-1)!.text.match(/\d{6}/)![0];
    const res = await walkIn(w, { phone: w.guard.phone, otp: loginOtp });
    expect(res.status).toBe(401);
  });

  it('walk-in without consent 422, OTP not used up', async () => {
    const w = await world();
    const otp = await otpFor(w.token);
    const first = await walkIn(w, { consent: false, otp });
    expect(first.status).toBe(422);
    expect(first.body.error).toBe('CONSENT_REQUIRED');
    expect(await ctx.prisma.visit.count()).toBe(0);
  });

  it('walk-in => PENDING_APPROVAL, host gets APPROVAL_REQUEST, 3 jobs queued', async () => {
    const w = await world();
    const res = await walkIn(w);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING_APPROVAL');
    expect(res.body.code).toMatch(/^VIS-/);
    const visit = await ctx.prisma.visit.findUniqueOrThrow({ where: { id: res.body.visitId } });
    expect(visit.type).toBe('WALKIN');
    expect(visit.validTo.getTime() - visit.validFrom.getTime()).toBe(4 * 3_600_000);
    const box = await ctx.prisma.outbox.findFirstOrThrow({ where: { visitId: visit.id } });
    expect(box.template).toBe('APPROVAL_REQUEST');
    expect(box.recipient).toBe(w.host.id);
    expect(box.vars).toEqual({ visitorName: 'Rahul Verma', company: 'ACME' });
    const jobs = await ctx.app.get(JobsService).queue.getDelayed();
    const delays = Object.fromEntries(jobs.map((j) => [j.name, j.opts.delay]));
    expect(delays).toEqual({ 'approval.reminder': 90_000, 'approval.delegate': 180_000, 'approval.reception': 300_000 });
    const visitor = await ctx.prisma.visitor.findFirstOrThrow();
    expect(visitor.consentAt).toBeTruthy();
    expect(visitor.consentVersion).toBe('v1');
  });

  it('host of other site rejected', async () => {
    const w = await world();
    const other = await seedSite(ctx.prisma, 'Plant 2');
    const farHost = await seedUser(ctx.prisma, other.site.id);
    const res = await walkIn(w, { hostId: farHost.id });
    expect(res.status).toBe(422);
    expect(await ctx.prisma.visit.count()).toBe(0);
  });

  it('photo uploaded by someone else rejected', async () => {
    const w = await world();
    const otherGuard = await seedUser(ctx.prisma, w.site.id, 'guard');
    const foreign = await photoKey(await tokenFor(ctx, otherGuard.id));
    expect((await walkIn(w, { photoKey: foreign })).status).toBe(422);
  });

  it('new visitor without photo rejected', async () => {
    const w = await world();
    expect((await walkIn(w, { photoKey: undefined })).status).toBe(422);
  });

  it('known visitor can reuse saved photo', async () => {
    const w = await world();
    await ctx.prisma.visitor.create({ data: { phone: PHONE, name: 'Rahul', photoKey: 'visitors/old/p.jpg' } });
    const res = await walkIn(w, { photoKey: undefined });
    expect(res.status).toBe(201);
    expect((await ctx.prisma.visitor.findFirstOrThrow()).photoKey).toBe('visitors/old/p.jpg');
  });

  it('same clientEventId retry returns same visit', async () => {
    const w = await world();
    const clientEventId = randomUUID();
    const first = await walkIn(w, { clientEventId });
    const second = await http()
      .post('/gate/walk-ins')
      .set(auth(w.token))
      .send({ phone: PHONE, otp: '000000', name: 'x', hostId: w.host.id, purpose: 'x', gateId: w.gate.id, consent: true, clientEventId });
    expect(second.status).toBe(201);
    expect(second.body.visitId).toBe(first.body.visitId);
    expect(await ctx.prisma.visit.count()).toBe(1);
  });

  it('host approves => APPROVED, PASS_READY queued, link works', async () => {
    const w = await world();
    const id = await pendingVisit(w);
    const res = await http()
      .post(`/visits/${id}/approve`)
      .set(auth(await tokenFor(ctx, w.host.id)))
      .send({ note: '10 minute baithao' })
      .expect(200);
    expect(res.body.status).toBe('APPROVED');
    const box = await ctx.prisma.outbox.findFirstOrThrow({ where: { visitId: id, template: 'PASS_READY' } });
    expect(box.recipient).toBe(PHONE);
    const link = (box.vars as { link: string }).link.split('/v/')[1];
    const pub = await http().get(`/public/invites/${link}`).expect(200);
    expect(pub.body.pass).toMatch(/^v1\./);
  });

  it('guard sees the decision note on the visit', async () => {
    const w = await world();
    const id = await pendingVisit(w);
    const hostToken = await tokenFor(ctx, w.host.id);
    await http().post(`/visits/${id}/approve`).set(auth(hostToken)).send({ note: '10 minute baithao' }).expect(200);
    const res = await http().get(`/visits/${id}`).set(auth(w.token)).expect(200);
    expect(res.body.decisionNote).toBe('10 minute baithao');
  });

  it('reject stores reason, visit REJECTED, no pass', async () => {
    const w = await world();
    const id = await pendingVisit(w);
    const hostToken = await tokenFor(ctx, w.host.id);
    await http().post(`/visits/${id}/reject`).set(auth(hostToken)).send({ reason: 'Aaj nahi' }).expect(200);
    const res = await http().get(`/visits/${id}`).set(auth(w.token)).expect(200);
    expect(res.body.status).toBe('REJECTED');
    expect(res.body.decisionNote).toBe('Aaj nahi');
    expect(await ctx.prisma.outbox.count({ where: { visitId: id, template: 'PASS_READY' } })).toBe(0);
  });

  it('delegate approves; actor is delegate', async () => {
    const w = await world();
    const backup = await seedUser(ctx.prisma, w.site.id);
    await ctx.prisma.user.update({ where: { id: w.host.id }, data: { delegateId: backup.id } });
    const id = await pendingVisit(w);
    await http().post(`/visits/${id}/approve`).set(auth(await tokenFor(ctx, backup.id))).send({}).expect(200);
    const event = await ctx.prisma.visitEvent.findFirstOrThrow({ where: { visitId: id, type: 'APPROVE' } });
    expect(event.actorId).toBe(backup.id);
  });

  it('unrelated employee 403', async () => {
    const w = await world();
    const other = await seedUser(ctx.prisma, w.site.id);
    const id = await pendingVisit(w);
    await http().post(`/visits/${id}/approve`).set(auth(await tokenFor(ctx, other.id))).send({}).expect(403);
  });

  it('guard cannot approve', async () => {
    const w = await world();
    const id = await pendingVisit(w);
    await http().post(`/visits/${id}/approve`).set(auth(w.token)).send({}).expect(403);
  });

  it('second approver after decision 409 INVALID_TRANSITION with status', async () => {
    const w = await world();
    const id = await pendingVisit(w);
    const hostToken = await tokenFor(ctx, w.host.id);
    await http().post(`/visits/${id}/reject`).set(auth(hostToken)).send({}).expect(200);
    const res = await http().post(`/visits/${id}/approve`).set(auth(hostToken)).send({});
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'INVALID_TRANSITION', status: 'REJECTED' });
  });

  it('reminder job sends APPROVAL_REMINDER only while pending', async () => {
    const w = await world();
    const id = await pendingVisit(w);
    await timers.process({ name: 'reminder', data: { visitId: id } });
    const box = await ctx.prisma.outbox.findFirstOrThrow({ where: { visitId: id, template: 'APPROVAL_REMINDER' } });
    expect(box.recipient).toBe(w.host.id);
    expect(await ctx.prisma.visitEvent.count({ where: { visitId: id, type: 'REMINDER_SENT' } })).toBe(1);
  });

  it('delegate job notifies delegate; no-op without delegate', async () => {
    const w = await world();
    const id = await pendingVisit(w);
    await timers.process({ name: 'delegate', data: { visitId: id } });
    expect(await ctx.prisma.outbox.count({ where: { visitId: id, template: 'APPROVAL_REQUEST' } })).toBe(1);

    const backup = await seedUser(ctx.prisma, w.site.id);
    await ctx.prisma.user.update({ where: { id: w.host.id }, data: { delegateId: backup.id } });
    await timers.process({ name: 'delegate', data: { visitId: id } });
    const rows = await ctx.prisma.outbox.findMany({ where: { visitId: id, template: 'APPROVAL_REQUEST' } });
    expect(rows.map((r) => r.recipient)).toContain(backup.id);
  });

  it('reception job sets reception_call_requested_at', async () => {
    const w = await world();
    const id = await pendingVisit(w);
    await timers.process({ name: 'reception', data: { visitId: id } });
    const visit = await ctx.prisma.visit.findUniqueOrThrow({ where: { id } });
    expect(visit.receptionCallRequestedAt).toBeTruthy();
    expect(visit.status).toBe('PENDING_APPROVAL');
  });

  it('all jobs no-op after approval, and queued jobs are removed', async () => {
    const w = await world();
    const id = await pendingVisit(w);
    await http().post(`/visits/${id}/approve`).set(auth(await tokenFor(ctx, w.host.id))).send({}).expect(200);
    expect(await ctx.app.get(JobsService).queue.getDelayed()).toHaveLength(0);
    const before = await ctx.prisma.outbox.count({ where: { visitId: id } });
    for (const name of ['reminder', 'delegate', 'reception'] as const) {
      await timers.process({ name, data: { visitId: id } });
    }
    expect(await ctx.prisma.outbox.count({ where: { visitId: id } })).toBe(before);
    expect((await ctx.prisma.visit.findUniqueOrThrow({ where: { id } })).receptionCallRequestedAt).toBeNull();
  });

  it('job for a missing visit does not crash', async () => {
    await expect(
      timers.process({ name: 'reminder', data: { visitId: '00000000-0000-0000-0000-000000000000' } }),
    ).resolves.toBeUndefined();
  });

  it('reception approves on behalf; event shows reception actor', async () => {
    const w = await world();
    const desk = await seedUser(ctx.prisma, w.site.id, 'reception');
    const id = await pendingVisit(w);
    await http().post(`/visits/${id}/approve`).set(auth(await tokenFor(ctx, desk.id))).send({}).expect(200);
    const event = await ctx.prisma.visitEvent.findFirstOrThrow({ where: { visitId: id, type: 'APPROVE' } });
    expect(event.actorId).toBe(desk.id);
  });

  it('approved walk-in can be checked in by guard', async () => {
    const w = await world();
    const id = await pendingVisit(w);
    await http().post(`/visits/${id}/approve`).set(auth(await tokenFor(ctx, w.host.id))).send({}).expect(200);
    const res = await http()
      .post(`/visits/${id}/check-in`)
      .set(auth(w.token))
      .send({ gateId: w.gate.id, clientEventId: randomUUID() });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('CHECKED_IN');
  });

  it('PRE visit cannot be approved', async () => {
    const w = await world();
    const visit = await seedVisit(ctx.prisma, { status: 'INVITED', siteId: w.site.id, hostId: w.host.id });
    await http().post(`/visits/${visit.id}/approve`).set(auth(await tokenFor(ctx, w.host.id))).send({}).expect(409);
  });
});
