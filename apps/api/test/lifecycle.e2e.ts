import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaClient } from '@prisma/client';
import { InvalidTransitionError } from '../src/visits/errors';
import { VisitLifecycleService } from '../src/visits/visit-lifecycle.service';
import { seedVisit } from './factories';
import { createTestApp, resetData, TestContext } from './setup';

describe('VisitLifecycleService', () => {
  let ctx: TestContext;
  let lifecycle: VisitLifecycleService;
  const countEvents = (visitId: string, type: string) =>
    ctx.prisma.visitEvent.count({ where: { visitId, type } });

  beforeAll(async () => {
    ctx = await createTestApp();
    lifecycle = ctx.app.get(VisitLifecycleService);
  });
  beforeEach(() => resetData(ctx));
  afterAll(() => ctx.app.close());

  it('applies transition, writes event, writes outbox in one tx', async () => {
    const visit = await seedVisit(ctx.prisma);
    const updated = await lifecycle.apply({
      visitId: visit.id,
      action: 'CHECK_IN',
      actorId: visit.hostId,
      patch: { checkedInAt: new Date() },
      notify: [{ channel: 'PUSH', template: 'VISITOR_ARRIVED', recipient: visit.hostId, vars: { visitorName: 'R', gateName: 'G' } }],
    });
    expect(updated.status).toBe('CHECKED_IN');
    expect(updated.checkedInAt).toBeInstanceOf(Date);
    expect(await countEvents(visit.id, 'CHECK_IN')).toBe(1);
    const box = await ctx.prisma.outbox.findMany({ where: { visitId: visit.id } });
    expect(box).toHaveLength(1);
    expect(box[0].status).toBe('PENDING');
  });

  it('invalid transition throws and writes nothing', async () => {
    const visit = await seedVisit(ctx.prisma, { status: 'REJECTED' });
    await expect(lifecycle.apply({ visitId: visit.id, action: 'CHECK_IN', actorId: null })).rejects.toThrow(
      InvalidTransitionError,
    );
    expect(await ctx.prisma.visitEvent.count()).toBe(0);
    expect((await ctx.prisma.visit.findUniqueOrThrow({ where: { id: visit.id } })).status).toBe('REJECTED');
  });

  it('InvalidTransitionError carries the current status', async () => {
    const visit = await seedVisit(ctx.prisma, { status: 'CHECKED_OUT' });
    const err = await lifecycle.apply({ visitId: visit.id, action: 'CHECK_IN', actorId: null }).catch((e) => e);
    expect(err.getStatus()).toBe(409);
    expect(err.getResponse()).toMatchObject({ error: 'INVALID_TRANSITION', status: 'CHECKED_OUT' });
  });

  it('outbox insert failure rolls back status and event', async () => {
    const visit = await seedVisit(ctx.prisma);
    await expect(
      lifecycle.apply({
        visitId: visit.id,
        action: 'CHECK_IN',
        actorId: null,
        notify: [
          {
            channel: 'PUSH',
            template: 'VISITOR_ARRIVED',
            recipient: 'x',
            vars: { visitorName: 'R', gateName: 'G' },
            visitId: '00000000-0000-0000-0000-000000000000',
          },
        ],
      }),
    ).rejects.toThrow();
    expect((await ctx.prisma.visit.findUniqueOrThrow({ where: { id: visit.id } })).status).toBe('APPROVED');
    expect(await countEvents(visit.id, 'CHECK_IN')).toBe(0);
  });

  it('parallel apply: one wins, other gets InvalidTransitionError', async () => {
    const visit = await seedVisit(ctx.prisma);
    const go = () => lifecycle.apply({ visitId: visit.id, action: 'CHECK_IN', actorId: null });
    const r = await Promise.allSettled([go(), go()]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const lost = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(InvalidTransitionError);
    expect(await countEvents(visit.id, 'CHECK_IN')).toBe(1);
  });

  it('emits visit.updated only after commit', async () => {
    const visit = await seedVisit(ctx.prisma);
    const outside = new PrismaClient();
    const seen: string[] = [];
    const seenPromise = new Promise<void>((resolve) => {
      ctx.app.get(EventEmitter2).once('visit.updated', async (e: { visitId: string; premisesId: string; status: string }) => {
        const row = await outside.visit.findUniqueOrThrow({ where: { id: e.visitId } });
        seen.push(row.status, e.status, e.premisesId);
        resolve();
      });
    });
    await lifecycle.apply({ visitId: visit.id, action: 'CHECK_IN', actorId: null });
    await seenPromise;
    await outside.$disconnect();
    expect(seen).toEqual(['CHECKED_IN', 'CHECKED_IN', visit.premisesId]);
  });

  it('failed apply emits nothing', async () => {
    const visit = await seedVisit(ctx.prisma, { status: 'REJECTED' });
    const listener = jest.fn();
    ctx.app.get(EventEmitter2).once('visit.updated', listener);
    await lifecycle.apply({ visitId: visit.id, action: 'CHECK_IN', actorId: null }).catch(() => undefined);
    expect(listener).not.toHaveBeenCalled();
    ctx.app.get(EventEmitter2).removeListener('visit.updated', listener);
  });

  it('recordEvent adds event without status change', async () => {
    const visit = await seedVisit(ctx.prisma);
    await lifecycle.recordEvent(visit.id, 'REMINDER_SENT', null, { to: 'host' });
    expect(await countEvents(visit.id, 'REMINDER_SENT')).toBe(1);
    expect((await ctx.prisma.visit.findUniqueOrThrow({ where: { id: visit.id } })).status).toBe('APPROVED');
  });
});
