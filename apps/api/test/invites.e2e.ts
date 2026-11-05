import request from 'supertest';
import { seedSite, seedUser } from './factories';
import { createTestApp, resetData, TestContext, tokenFor } from './setup';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(200, 1)]);

describe('invites', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(() => resetData(ctx));
  afterAll(() => ctx.app.close());

  async function host(role: 'employee' | 'reception' | 'guard' = 'employee') {
    const { site, gate } = await seedSite(ctx.prisma);
    const user = await seedUser(ctx.prisma, site.id, role, { name: 'Anita Singh' });
    return { site, gate, user, token: await tokenFor(ctx, user.id) };
  }

  const inviteBody = (over: object = {}) => ({
    visitorName: 'Rahul Verma',
    visitorPhone: '98765 43210',
    validFrom: hoursFromNow(1),
    validTo: hoursFromNow(4),
    purpose: 'Meeting',
    ...over,
  });

  async function invite(token: string, over: object = {}) {
    const res = await http().post('/visits').set('Authorization', `Bearer ${token}`).send(inviteBody(over));
    expect(res.status).toBe(201);
    return res.body as { id: string; code: string; status: string };
  }

  async function linkTokenOf(visitId: string, template = 'INVITE_LINK') {
    const row = await ctx.prisma.outbox.findFirstOrThrow({
      where: { visitId, template },
      orderBy: { createdAt: 'desc' },
    });
    return (row.vars as { link: string }).link.split('/v/')[1];
  }

  async function uploadPhoto(linkToken: string) {
    const res = await http()
      .post(`/public/invites/${linkToken}/photo`)
      .attach('photo', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(201);
    return res.body.key as string;
  }

  async function registerBody(linkToken: string, over: object = {}) {
    return { name: 'Rahul Verma', photoKey: await uploadPhoto(linkToken), consent: true, ...over };
  }

  it('invite creates visit INVITED, CREATED event and INVITE_LINK outbox', async () => {
    const { token, site, user } = await host();
    const body = await invite(token);
    expect(body.status).toBe('INVITED');
    expect(body.code).toMatch(/^VIS-\d{4}-\d{5}$/);
    const visit = await ctx.prisma.visit.findUniqueOrThrow({ where: { id: body.id } });
    expect(visit.hostId).toBe(user.id);
    expect(visit.siteId).toBe(site.id);
    expect(await ctx.prisma.visitEvent.count({ where: { visitId: body.id, type: 'CREATED' } })).toBe(1);
    const box = await ctx.prisma.outbox.findFirstOrThrow({ where: { visitId: body.id } });
    expect(box.template).toBe('INVITE_LINK');
    expect(box.recipient).toBe('+919876543210');
    expect((box.vars as { link: string }).link).toMatch(/^http:\/\/web\.test\/v\/.+/);
  });

  it('stores only a hash of the invite token', async () => {
    const { token } = await host();
    const body = await invite(token);
    const linkToken = await linkTokenOf(body.id);
    const visit = await ctx.prisma.visit.findUniqueOrThrow({ where: { id: body.id } });
    expect(visit.inviteTokenHash).toBeTruthy();
    expect(visit.inviteTokenHash).not.toBe(linkToken);
  });

  it('three phone formats map to one visitor row', async () => {
    const { token } = await host();
    for (const visitorPhone of ['98765 43210', '+91-98765-43210', '09876543210']) {
      await invite(token, { visitorPhone });
    }
    expect(await ctx.prisma.visitor.count()).toBe(1);
  });

  it('invalid phone rejected', async () => {
    const { token } = await host();
    await http().post('/visits').set('Authorization', `Bearer ${token}`).send(inviteBody({ visitorPhone: '123' })).expect(422);
  });

  it('invite does not overwrite existing visitor name', async () => {
    const { token } = await host();
    await invite(token, { visitorName: 'Rahul Verma' });
    await invite(token, { visitorName: 'Someone Else' });
    expect((await ctx.prisma.visitor.findFirstOrThrow()).name).toBe('Rahul Verma');
  });

  it('validTo before validFrom rejected', async () => {
    const { token } = await host();
    await http()
      .post('/visits')
      .set('Authorization', `Bearer ${token}`)
      .send(inviteBody({ validFrom: hoursFromNow(3), validTo: hoursFromNow(2) }))
      .expect(422);
  });

  it('window over 24h rejected', async () => {
    const { token } = await host();
    await http()
      .post('/visits')
      .set('Authorization', `Bearer ${token}`)
      .send(inviteBody({ validFrom: hoursFromNow(1), validTo: hoursFromNow(26) }))
      .expect(422);
  });

  it('guard cannot create invite', async () => {
    const { token } = await host('guard');
    await http().post('/visits').set('Authorization', `Bearer ${token}`).send(inviteBody()).expect(403);
  });

  it('employee sees mine only; scope=site forbidden', async () => {
    const { token, site } = await host();
    const other = await seedUser(ctx.prisma, site.id);
    const otherToken = await tokenFor(ctx, other.id);
    const mine = await invite(token);
    await invite(otherToken, { visitorPhone: '9876500000' });
    const res = await http().get('/visits?scope=mine').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.map((v: { id: string }) => v.id)).toEqual([mine.id]);
    expect(res.body[0].visitorName).toBe('Rahul Verma');
    expect(res.body[0].hostName).toBe('Anita Singh');
    await http().get('/visits?scope=site').set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('delegate sees the host visits in mine', async () => {
    const { token, user, site } = await host();
    const backup = await seedUser(ctx.prisma, site.id);
    await ctx.prisma.user.update({ where: { id: user.id }, data: { delegateId: backup.id } });
    const visit = await invite(token);
    const res = await http().get('/visits').set('Authorization', `Bearer ${await tokenFor(ctx, backup.id)}`).expect(200);
    expect(res.body.map((v: { id: string }) => v.id)).toEqual([visit.id]);
  });

  it('GET /visits/:id blocked for unrelated employee', async () => {
    const { token, site } = await host();
    const visit = await invite(token);
    const other = await seedUser(ctx.prisma, site.id);
    await http().get(`/visits/${visit.id}`).set('Authorization', `Bearer ${await tokenFor(ctx, other.id)}`).expect(403);
    const own = await http().get(`/visits/${visit.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(own.body.purpose).toBe('Meeting');
  });

  it('unknown token 404 NOT_FOUND', async () => {
    const res = await http().get('/public/invites/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  it('GET returns details without pass before registration, and no phone', async () => {
    const { token } = await host();
    const visit = await invite(token);
    const res = await http().get(`/public/invites/${await linkTokenOf(visit.id)}`).expect(200);
    expect(res.body).toMatchObject({
      status: 'INVITED',
      visitorName: 'Rahul Verma',
      hostName: 'Anita Singh',
      siteName: 'Main Site',
      pass: null,
    });
    expect(JSON.stringify(res.body)).not.toContain('98765');
  });

  it('register without consent 422 CONSENT_REQUIRED, stays INVITED', async () => {
    const { token } = await host();
    const visit = await invite(token);
    const t = await linkTokenOf(visit.id);
    const res = await http().post(`/public/invites/${t}/register`).send(await registerBody(t, { consent: false }));
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('CONSENT_REQUIRED');
    expect((await ctx.prisma.visit.findUniqueOrThrow({ where: { id: visit.id } })).status).toBe('INVITED');
  });

  it('register sets APPROVED, consent_at, delete_after +180d, returns pass', async () => {
    const { token } = await host();
    const visit = await invite(token);
    const t = await linkTokenOf(visit.id);
    const res = await http()
      .post(`/public/invites/${t}/register`)
      .send(await registerBody(t, { company: 'ACME', idType: 'PAN', idLast4: '1234' }))
      .expect(201);
    expect(res.body.status).toBe('APPROVED');
    expect(res.body.pass).toMatch(/^v1\./);
    const row = await ctx.prisma.visitor.findFirstOrThrow();
    expect(row.company).toBe('ACME');
    expect(row.idLast4).toBe('1234');
    expect(row.consentVersion).toBe('v1');
    const days = (row.deleteAfter!.getTime() - row.consentAt!.getTime()) / 86_400_000;
    expect(days).toBe(180);
    expect(await ctx.prisma.visitEvent.count({ where: { visitId: visit.id, type: 'REGISTER' } })).toBe(1);
  });

  it('double register returns same pass 200', async () => {
    const { token } = await host();
    const visit = await invite(token);
    const t = await linkTokenOf(visit.id);
    const body = await registerBody(t);
    const first = await http().post(`/public/invites/${t}/register`).send(body).expect(201);
    const second = await http().post(`/public/invites/${t}/register`).send(body);
    expect(second.status).toBe(200);
    expect(second.body.pass).toBe(first.body.pass);
    expect(await ctx.prisma.visitEvent.count({ where: { visitId: visit.id, type: 'REGISTER' } })).toBe(1);
  });

  it('parallel register: both succeed, one event', async () => {
    const { token } = await host();
    const visit = await invite(token);
    const t = await linkTokenOf(visit.id);
    const body = await registerBody(t);
    const [a, b] = await Promise.all([
      http().post(`/public/invites/${t}/register`).send(body),
      http().post(`/public/invites/${t}/register`).send(body),
    ]);
    expect(a.body.pass).toBeTruthy();
    expect(b.body.pass).toBe(a.body.pass);
    expect(await ctx.prisma.visitEvent.count({ where: { visitId: visit.id, type: 'REGISTER' } })).toBe(1);
  });

  it('idLast4 "123456789012" rejected and never stored', async () => {
    const { token } = await host();
    const visit = await invite(token);
    const t = await linkTokenOf(visit.id);
    await http().post(`/public/invites/${t}/register`).send(await registerBody(t, { idLast4: '123456789012' })).expect(422);
    expect((await ctx.prisma.visitor.findFirstOrThrow()).idLast4).toBeNull();
  });

  it('photoKey of another visit rejected', async () => {
    const { token } = await host();
    const a = await invite(token);
    const b = await invite(token, { visitorPhone: '9876500000' });
    const ta = await linkTokenOf(a.id);
    const tb = await linkTokenOf(b.id);
    const keyOfB = await uploadPhoto(tb);
    await http()
      .post(`/public/invites/${ta}/register`)
      .send({ name: 'R', photoKey: keyOfB, consent: true })
      .expect(422);
  });

  it('photoKey that was never uploaded rejected', async () => {
    const { token } = await host();
    const visit = await invite(token);
    const t = await linkTokenOf(visit.id);
    await http()
      .post(`/public/invites/${t}/register`)
      .send({ name: 'R', photoKey: `visitors/${visit.id}/nope.jpg`, consent: true })
      .expect(422);
  });

  it('photo over 1 MB rejected', async () => {
    const { token } = await host();
    const visit = await invite(token);
    const t = await linkTokenOf(visit.id);
    const big = Buffer.concat([JPEG, Buffer.alloc(1024 * 1024 + 1)]);
    await http().post(`/public/invites/${t}/photo`).attach('photo', big, { filename: 'a.jpg', contentType: 'image/jpeg' }).expect(413);
  });

  it('PNG renamed as .jpg rejected by magic bytes', async () => {
    const { token } = await host();
    const visit = await invite(token);
    const t = await linkTokenOf(visit.id);
    await http().post(`/public/invites/${t}/photo`).attach('photo', PNG, { filename: 'a.jpg', contentType: 'image/jpeg' }).expect(422);
  });

  it('photo missing from request rejected', async () => {
    const { token } = await host();
    const visit = await invite(token);
    await http().post(`/public/invites/${await linkTokenOf(visit.id)}/photo`).expect(422);
  });

  it('photoUrl points to API host, not the storage host', async () => {
    const { token } = await host();
    const visit = await invite(token);
    const t = await linkTokenOf(visit.id);
    await http().post(`/public/invites/${t}/register`).send(await registerBody(t)).expect(201);
    const res = await http().get(`/visits/${visit.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.photoUrl).toMatch(/^http:\/\/api\.test\/photos\//);
    const path = new URL(res.body.photoUrl).pathname;
    const img = await http().get(path).expect(200);
    expect(img.headers['content-type']).toMatch(/image\/jpeg/);
    expect(Buffer.compare(img.body, JPEG)).toBe(0);
  });

  it('expired photo token rejected', async () => {
    const { StorageService } = await import('../src/storage/storage.service');
    const url = await ctx.app.get(StorageService).photoUrl('visitors/x/y.jpg', -10);
    await http().get(new URL(url).pathname).expect(401);
  });

  it('garbage photo token rejected', async () => {
    await http().get('/photos/not-a-token').expect(401);
  });

  it('register after validTo 410 INVITE_EXPIRED', async () => {
    const { token } = await host();
    const visit = await invite(token);
    const t = await linkTokenOf(visit.id);
    const body = await registerBody(t);
    await ctx.prisma.visit.update({
      where: { id: visit.id },
      data: { validFrom: new Date(Date.now() - 7_200_000), validTo: new Date(Date.now() - 60_000) },
    });
    const res = await http().post(`/public/invites/${t}/register`).send(body);
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('INVITE_EXPIRED');
  });

  it('cancelled visit GET has status CANCELLED, pass null', async () => {
    const { token } = await host();
    const visit = await invite(token);
    const t = await linkTokenOf(visit.id);
    await http().post(`/visits/${visit.id}/cancel`).set('Authorization', `Bearer ${token}`).expect(200);
    const res = await http().get(`/public/invites/${t}`).expect(200);
    expect(res.body.status).toBe('CANCELLED');
    expect(res.body.pass).toBeNull();
  });

  it('unrelated employee cannot cancel', async () => {
    const { token, site } = await host();
    const visit = await invite(token);
    const other = await seedUser(ctx.prisma, site.id);
    await http().post(`/visits/${visit.id}/cancel`).set('Authorization', `Bearer ${await tokenFor(ctx, other.id)}`).expect(403);
  });

  it('resend rotates token: old link 404', async () => {
    const { token } = await host();
    const visit = await invite(token);
    const oldLink = await linkTokenOf(visit.id);
    await new Promise((r) => setTimeout(r, 5));
    await http().post(`/visits/${visit.id}/resend-invite`).set('Authorization', `Bearer ${token}`).expect(204);
    const newLink = await linkTokenOf(visit.id);
    expect(newLink).not.toBe(oldLink);
    await http().get(`/public/invites/${oldLink}`).expect(404);
    await http().get(`/public/invites/${newLink}`).expect(200);
  });

  it('public routes are rate limited per IP', async () => {
    process.env.PUBLIC_RATE_LIMIT = '3';
    try {
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) {
        codes.push((await http().get('/public/invites/nope').set('X-Forwarded-For', '203.0.113.9')).status);
      }
      expect(codes).toEqual([404, 404, 404, 429, 429]);
      const other = await http().get('/public/invites/nope').set('X-Forwarded-For', '203.0.113.10');
      expect(other.status).toBe(404);
    } finally {
      process.env.PUBLIC_RATE_LIMIT = '100000';
    }
  });
});
