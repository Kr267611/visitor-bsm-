import request from 'supertest';
import { createTestApp, resetData, TestContext } from './setup';
import { seedVisitEvent } from './factories';

describe('foundation', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(() => resetData(ctx));
  afterAll(() => ctx.app.close());

  it('GET /health returns ok with db and redis', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up', redis: 'up' });
  });

  it('visit_events rejects update', async () => {
    const e = await seedVisitEvent(ctx.prisma);
    await expect(
      ctx.prisma.$executeRaw`UPDATE visit_events SET type='X' WHERE id=${e.id}::uuid`,
    ).rejects.toThrow(/append-only/);
  });

  it('visit_events rejects delete', async () => {
    const e = await seedVisitEvent(ctx.prisma);
    await expect(
      ctx.prisma.$executeRaw`DELETE FROM visit_events WHERE id=${e.id}::uuid`,
    ).rejects.toThrow(/append-only/);
  });

  it('duplicate client_event_id rejected', async () => {
    await seedVisitEvent(ctx.prisma, 'same-id');
    await expect(seedVisitEvent(ctx.prisma, 'same-id')).rejects.toThrow(/client_event_id|Unique/i);
  });

  it('unknown route uses the standard error shape', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/nope').expect(404);
    expect(res.body.error).toBe('NOT_FOUND');
    expect(typeof res.body.message).toBe('string');
  });

  it('visit code sequence gives increasing values', async () => {
    const [a] = await ctx.prisma.$queryRaw<{ v: bigint }[]>`SELECT nextval('visit_code_seq') AS v`;
    const [b] = await ctx.prisma.$queryRaw<{ v: bigint }[]>`SELECT nextval('visit_code_seq') AS v`;
    expect(b.v).toBeGreaterThan(a.v);
  });
});
