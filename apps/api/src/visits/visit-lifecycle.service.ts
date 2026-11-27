import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, Visit } from '@prisma/client';
import { nextStatus, VisitAction } from '@visitor/shared';
import { ApiException } from '../common/api-exception';
import { istYear } from '../common/time';
import { OutboxDraft, renderTemplate } from '../notifications/templates';
import { TENANT_PRISMA, TenantPrismaClient, TenantTx } from '../tenancy/tenant-prisma';
import { InvalidTransitionError } from './errors';

export const VISIT_UPDATED = 'visit.updated';

export interface VisitUpdatedEvent {
  visitId: string;
  businessId: string;
  premisesId: string;
  status: Visit['status'];
}

export interface ApplyInput {
  visitId: string;
  action: VisitAction;
  actorId: string | null;
  gateId?: string;
  deviceId?: string;
  clientEventId?: string;
  patch?: Partial<
    Pick<
      Visit,
      'checkedInAt' | 'checkedOutAt' | 'inGateId' | 'outGateId' | 'inviteTokenHash' | 'gatePassNo' | 'itemsOut'
    >
  >;
  notify?: OutboxDraft[];
  meta?: object;
  /** Runs together with the status change, in the same transaction. */
  inTx?: (tx: TenantTx) => Promise<void>;
}

/**
 * `visits.status` changes only here: status, audit event and outbox in one transaction.
 * Scoped client: the HTTP request's business, or `runInTenant` for jobs and public links. Throws without a context.
 */
@Injectable()
export class VisitLifecycleService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrismaClient,
    private readonly events: EventEmitter2,
  ) {}

  async apply(input: ApplyInput): Promise<Visit> {
    const drafts = input.notify ?? [];
    drafts.forEach((d) => renderTemplate(d.template, d.vars));

    const visit = await this.prisma.$transaction(async (tx) => {
      const current = await tx.visit.findUnique({ where: { id: input.visitId } });
      if (!current) throw new ApiException(404, 'NOT_FOUND', 'Visit not found.');

      const to = nextStatus(current.status, input.action);
      if (!to) throw new InvalidTransitionError(current.status);

      // Update conditioned on the status: when two people act at once, only one wins.
      const { count } = await tx.visit.updateMany({
        where: { id: current.id, status: current.status },
        data: { status: to, ...input.patch },
      });
      if (count !== 1) {
        const fresh = await tx.visit.findUniqueOrThrow({ where: { id: current.id } });
        throw new InvalidTransitionError(fresh.status);
      }
      await input.inTx?.(tx);

      await tx.visitEvent.create({
        data: {
          visitId: current.id,
          businessId: current.businessId,
          type: input.action,
          actorId: input.actorId,
          gateId: input.gateId,
          deviceId: input.deviceId,
          clientEventId: input.clientEventId,
          meta: input.meta as Prisma.InputJsonValue | undefined,
        },
      });
      if (drafts.length) {
        await tx.outbox.createMany({
          data: drafts.map((d) => ({
            visitId: d.visitId ?? current.id,
            businessId: current.businessId,
            channel: d.channel,
            template: d.template,
            recipient: d.recipient,
            vars: d.vars,
          })),
        });
      }
      return tx.visit.findUniqueOrThrow({ where: { id: current.id } });
    });

    const event: VisitUpdatedEvent = {
      visitId: visit.id,
      businessId: visit.businessId,
      premisesId: visit.premisesId,
      status: visit.status,
    };
    this.events.emit(VISIT_UPDATED, event);
    return visit;
  }

  /** New visit: code, CREATED event and outbox in one transaction. */
  async create(input: {
    data: Omit<Prisma.VisitUncheckedCreateInput, 'code'>;
    actorId: string | null;
    gateId?: string;
    deviceId?: string;
    clientEventId?: string;
    notify?: OutboxDraft[];
  }): Promise<Visit> {
    const drafts = input.notify ?? [];
    drafts.forEach((d) => renderTemplate(d.template, d.vars));

    const visit = await this.prisma.$transaction(async (tx) => {
      const [{ seq }] = await tx.$queryRaw<{ seq: bigint }[]>`SELECT nextval('visit_code_seq') AS seq`;
      const code = `VIS-${istYear(new Date())}-${String(seq).padStart(5, '0')}`;
      const created = await tx.visit.create({ data: { ...input.data, code } });
      await tx.visitEvent.create({
        data: {
          visitId: created.id,
          businessId: created.businessId,
          type: 'CREATED',
          actorId: input.actorId,
          gateId: input.gateId,
          deviceId: input.deviceId,
          clientEventId: input.clientEventId,
        },
      });
      if (drafts.length) {
        await tx.outbox.createMany({
          data: drafts.map((d) => ({
            visitId: created.id,
            businessId: created.businessId,
            channel: d.channel,
            template: d.template,
            recipient: d.recipient,
            vars: d.vars,
          })),
        });
      }
      return created;
    });

    const event: VisitUpdatedEvent = {
      visitId: visit.id,
      businessId: visit.businessId,
      premisesId: visit.premisesId,
      status: visit.status,
    };
    this.events.emit(VISIT_UPDATED, event);
    return visit;
  }

  /** Event without a status change: CREATED, REMINDER_SENT and so on. */
  async recordEvent(
    visitId: string,
    type: string,
    actorId: string | null,
    meta?: object,
    notify: OutboxDraft[] = [],
  ): Promise<void> {
    notify.forEach((d) => renderTemplate(d.template, d.vars));
    const { businessId } = await this.prisma.visit.findUniqueOrThrow({ where: { id: visitId }, select: { businessId: true } });
    await this.prisma.$transaction([
      this.prisma.visitEvent.create({
        data: { visitId, businessId, type, actorId, meta: meta as Prisma.InputJsonValue | undefined },
      }),
      this.prisma.outbox.createMany({
        data: notify.map((d) => ({
          visitId,
          businessId,
          channel: d.channel,
          template: d.template,
          recipient: d.recipient,
          vars: d.vars,
        })),
      }),
    ]);
  }

  /** Notify live screens even without a status change (such as reception's call task). */
  announce(visit: Pick<Visit, 'id' | 'businessId' | 'premisesId' | 'status'>): void {
    const event: VisitUpdatedEvent = {
      visitId: visit.id,
      businessId: visit.businessId,
      premisesId: visit.premisesId,
      status: visit.status,
    };
    this.events.emit(VISIT_UPDATED, event);
  }
}
