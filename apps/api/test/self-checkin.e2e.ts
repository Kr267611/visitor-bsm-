import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { seedBusiness, seedSite, seedUser } from './factories';
import { createTestApp, resetData, TestContext, tokenFor } from './setup';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);
const PHONE = '9876543210';

describe('QR self check-in', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const otpFrom = () => ctx.sms.sent.at(-1)!.text.match(/\d{6}/)![0];

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(() => resetData(ctx));
  afterAll(() => ctx.app.close());

  async function setup() {
    const { site, gate, business } = await seedSite(ctx.prisma, 'Head Office');
    const host = await seedUser(ctx.prisma, site.id, 'employee', { name: 'Anita Singh' });
    const guard = await seedUser(ctx.prisma, site.id, 'guard');
    const base = `/public/premises/${business.slug}/${site.webSlug}`;
    return { site, gate, business, host, guard, base };
  }

  async function verify(base: string, body: object = {}) {
    await http().post(`${base}/otp`).send({ phone: PHONE }).expect(204);
    const res = await http()
      .post(`${base}/verify`)
      .send({ phone: PHONE, otp: otpFrom(), ...body })
      .expect(200);
    return res.body as { sessionToken: string; visitor: unknown; activeVisit: { status: string; token: string } | null };
  }

  async function checkIn(base: string, session: string, hostId: string, over: object = {}) {
    const photo = await http()
      .post(`${base}/photo`)
      .set('x-checkin-session', session)
      .attach('photo', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(201);
    return http()
      .post(`${base}/check-in`)
      .set('x-checkin-session', session)
      .send({ name: 'Rahul Verma', company: 'ACME', purpose: 'Meeting', hostId, photoKey: photo.body.key, consent: true, ...over });
  }

  it('landing shows business, premises and that it is open', async () => {
    const { base } = await setup();
    const res = await http().get(base).expect(200);
    expect(res.body).toMatchObject({ premisesName: 'Head Office', status: 'open', needsLocation: false });
    expect(res.body.businessName).toEqual(expect.any(String));
    await http().get('/public/premises/nope/nope').expect(404);
  });

  it('full journey: OTP, host, photo, waiting, approval, gate, self check-out', async () => {
    const { base, host, guard, gate } = await setup();
    const { sessionToken, visitor, activeVisit } = await verify(base);
    expect(visitor).toBeNull();
    expect(activeVisit).toBeNull();

    const hosts = await http().get(`${base}/hosts?q=ani`).set('x-checkin-session', sessionToken).expect(200);
    expect(hosts.body).toEqual([{ id: host.id, name: 'Anita Singh', department: null }]);

    const res = await checkIn(base, sessionToken, host.id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'PENDING_APPROVAL', existing: false });
    const token = res.body.token as string;

    const visit = await ctx.prisma.visit.findFirstOrThrow({ where: { type: 'SELF' } });
    const box = await ctx.prisma.outbox.findMany({ where: { visitId: visit.id }, orderBy: { template: 'asc' } });
    expect(box.map((b) => [b.channel, b.template])).toEqual([
      ['PUSH', 'APPROVAL_REQUEST'],
      ['SMS', 'SELF_CHECKIN_LINK'],
    ]);
    expect((box[1].vars as { link: string }).link).toContain(token);

    // Waiting screen = the status link.
    const waiting = await http().get(`/public/invites/${token}`).expect(200);
    expect(waiting.body).toMatchObject({ status: 'PENDING_APPROVAL', pass: null });

    // Host approves: the same link now shows the pass.
    await http()
      .post(`/visits/${visit.id}/approve`)
      .set('Authorization', `Bearer ${await tokenFor(ctx, host.id)}`)
      .send({})
      .expect(200);
    const approved = await http().get(`/public/invites/${token}`).expect(200);
    expect(approved.body.status).toBe('APPROVED');
    expect(approved.body.pass).toMatch(/^v1\./);

    await http()
      .post('/gate/scan')
      .set('Authorization', `Bearer ${await tokenFor(ctx, guard.id)}`)
      .send({ qr: approved.body.pass, gateId: gate.id, mode: 'IN', clientEventId: randomUUID() })
      .expect(200);

    // Scanning the poster again on the way out.
    const again = await verify(base);
    expect(again.activeVisit?.status).toBe('CHECKED_IN');
    const out = await http().post(`${base}/check-out`).set('x-checkin-session', again.sessionToken).expect(200);
    expect(out.body.status).toBe('CHECKED_OUT');
    const events = await ctx.prisma.visitEvent.findMany({ where: { visitId: visit.id }, orderBy: { occurredAt: 'asc' } });
    expect(events.map((e) => e.type)).toEqual(['CREATED', 'APPROVE', 'CHECK_IN', 'CHECK_OUT']);
    expect(events.every((e) => e.businessId === visit.businessId)).toBe(true);
  });

  it('premises without approval issues the pass at once', async () => {
    const { base, site, host } = await setup();
    await ctx.prisma.premisesSetting.update({ where: { premisesId: site.id }, data: { checkinOnApproval: false } });
    const { sessionToken } = await verify(base);
    const res = await checkIn(base, sessionToken, host.id);
    expect(res.body.status).toBe('APPROVED');
    const page = await http().get(`/public/invites/${res.body.token}`).expect(200);
    expect(page.body.pass).toMatch(/^v1\./);
    const box = await ctx.prisma.outbox.findMany();
    expect(box.map((b) => b.template)).toEqual(['PASS_READY']);
  });

  it('scanning again never creates a second visit; the new link replaces the old one', async () => {
    const { base, host } = await setup();
    const first = await checkIn(base, (await verify(base)).sessionToken, host.id);
    const second = await verify(base);
    expect(second.activeVisit?.status).toBe('PENDING_APPROVAL');
    const again = await checkIn(base, second.sessionToken, host.id);
    expect(again.body.existing).toBe(true);
    expect(await ctx.prisma.visit.count()).toBe(1);
    await http().get(`/public/invites/${first.body.token}`).expect(404);
    await http().get(`/public/invites/${again.body.token}`).expect(200);
  });

  it('returning visitor is prefilled and may skip the photo', async () => {
    const { base, site, host } = await setup();
    await ctx.prisma.premisesSetting.update({ where: { premisesId: site.id }, data: { checkinOnApproval: false } });
    const first = await checkIn(base, (await verify(base)).sessionToken, host.id);
    await ctx.prisma.visit.updateMany({ data: { status: 'CHECKED_OUT' } });
    const back = await verify(base);
    expect(back.visitor).toEqual({ name: 'Rahul Verma', company: 'ACME', hasPhoto: true });
    const res = await http()
      .post(`${base}/check-in`)
      .set('x-checkin-session', back.sessionToken)
      .send({ name: 'Rahul Verma', purpose: 'Meeting', hostId: host.id, consent: true })
      .expect(201);
    expect(res.body.existing).toBe(false);
    expect(first.body.token).not.toBe(res.body.token);
  });

  it('new visitor needs a photo and consent; photo must come from this session', async () => {
    const { base, host } = await setup();
    const { sessionToken } = await verify(base);
    const send = (body: object) => http().post(`${base}/check-in`).set('x-checkin-session', sessionToken).send({ name: 'R', purpose: 'Meeting', hostId: host.id, consent: true, ...body });
    expect((await send({})).body.message).toMatch(/photo is required/);
    expect((await send({ photoKey: 'self/other/session/x.jpg' })).status).toBe(422);
    const res = await checkIn(base, sessionToken, host.id, { consent: false });
    expect(res.body.error).toBe('CONSENT_REQUIRED');
    expect(await ctx.prisma.visit.count()).toBe(0);
  });

  it('host must be an active host at this premises', async () => {
    const { base, business } = await setup();
    const other = await seedSite(ctx.prisma, 'Plant 2', business.id);
    const elsewhere = await seedUser(ctx.prisma, other.site.id, 'employee', { name: 'Anita Elsewhere' });
    const { sessionToken } = await verify(base);
    const hosts = await http().get(`${base}/hosts?q=anita`).set('x-checkin-session', sessionToken).expect(200);
    expect(hosts.body.map((h: { name: string }) => h.name)).toEqual(['Anita Singh']);
    const res = await checkIn(base, sessionToken, elsewhere.id);
    expect(res.status).toBe(422);
  });

  describe('location', () => {
    async function geofenced() {
      const s = await setup();
      await ctx.prisma.premises.update({ where: { id: s.site.id }, data: { lat: 21.17, lng: 72.83, geofenceM: 150 } });
      return s;
    }

    it('landing says location is needed; verify without it is refused', async () => {
      const { base } = await geofenced();
      expect((await http().get(base)).body.needsLocation).toBe(true);
      await http().post(`${base}/otp`).send({ phone: PHONE }).expect(204);
      const res = await http().post(`${base}/verify`).send({ phone: PHONE, otp: otpFrom() });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe('LOCATION_REQUIRED');
    });

    it('far away is refused even with a vague fix; nearby with a vague fix is allowed', async () => {
      const { base } = await geofenced();
      await http().post(`${base}/otp`).send({ phone: PHONE }).expect(204);
      const otp = otpFrom();
      const far = await http()
        .post(`${base}/verify`)
        .send({ phone: PHONE, otp, location: { lat: 21.2, lng: 72.83, accuracy: 5000 } });
      expect(far.status).toBe(403);
      expect(far.body.error).toBe('OUTSIDE_PREMISES');
      // ~200 m away, accuracy 80 m: inside 150 m + 80 m credit.
      const near = await http()
        .post(`${base}/verify`)
        .send({ phone: PHONE, otp, location: { lat: 21.1718, lng: 72.83, accuracy: 80 } });
      expect(near.status).toBe(200);
    });
  });

  describe('availability', () => {
    it('outside visiting hours is closed', async () => {
      const { base, site } = await setup();
      await ctx.prisma.premisesSetting.update({ where: { premisesId: site.id }, data: { visitStart: '23:59', visitEnd: '23:59' } });
      expect((await http().get(base)).body.status).toBe('closed');
      const res = await http().post(`${base}/otp`).send({ phone: PHONE });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('PREMISES_CLOSED');
      expect(ctx.sms.sent).toHaveLength(0);
    });

    it('module not in plan or inactive business is unavailable', async () => {
      const { base, business } = await setup();
      const plan = await ctx.prisma.plan.create({ data: { code: `p-${randomUUID().slice(0, 8)}`, name: 'No desk', features: ['dashboard'] } });
      await ctx.prisma.business.update({ where: { id: business.id }, data: { planId: plan.id } });
      expect((await http().get(base)).body.status).toBe('unavailable');
      expect((await http().post(`${base}/otp`).send({ phone: PHONE })).body.error).toBe('PREMISES_UNAVAILABLE');
      await ctx.prisma.business.update({ where: { id: business.id }, data: { isActive: false } });
      expect((await http().get(base)).body.status).toBe('unavailable');
    });
  });

  describe('security', () => {
    it('wrong OTP reveals nothing', async () => {
      const { base } = await setup();
      await http().post(`${base}/otp`).send({ phone: PHONE }).expect(204);
      const res = await http().post(`${base}/verify`).send({ phone: PHONE, otp: '000000' });
      expect(res.status).toBe(401);
      expect(res.body.sessionToken).toBeUndefined();
    });

    it('a session works only at its own premises', async () => {
      const { base, business } = await setup();
      const other = await seedSite(ctx.prisma, 'Plant 2', business.id);
      const otherBase = `/public/premises/${business.slug}/${other.site.webSlug}`;
      const { sessionToken } = await verify(base);
      await http().get(`${otherBase}/hosts`).set('x-checkin-session', sessionToken).expect(401);
      await http().get(`${base}/hosts`).expect(401);
    });

    it('a session is not a sign-in token, and a sign-in token is not a session', async () => {
      const { base, guard } = await setup();
      const { sessionToken } = await verify(base);
      await http().get('/me').set('Authorization', `Bearer ${sessionToken}`).expect(401);
      const signIn = await tokenFor(ctx, guard.id);
      await http().get(`${base}/hosts`).set('x-checkin-session', signIn).expect(401);
    });

    it('same premises slug in another business is a different premises', async () => {
      const { base, site } = await setup();
      const other = await seedBusiness(ctx.prisma);
      const theirs = await seedSite(ctx.prisma, 'Head Office', other.id);
      await ctx.prisma.premises.update({ where: { id: theirs.site.id }, data: { webSlug: site.webSlug } });
      const { sessionToken } = await verify(base);
      const otherBase = `/public/premises/${other.slug}/${site.webSlug}`;
      await http().get(`${otherBase}/hosts`).set('x-checkin-session', sessionToken).expect(401);
    });

    it('check-out without being inside is refused', async () => {
      const { base } = await setup();
      const { sessionToken } = await verify(base);
      const res = await http().post(`${base}/check-out`).set('x-checkin-session', sessionToken);
      expect(res.status).toBe(409);
    });
  });
});
