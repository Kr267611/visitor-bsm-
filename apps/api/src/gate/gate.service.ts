import { Inject, Injectable } from '@nestjs/common';
import { Gate, Prisma } from '@prisma/client';
import { AuthUser } from '../auth/roles.decorator';
import { ApiException } from '../common/api-exception';
import { RECEPTION_DESK, usedRequestId } from '../common/records';
import { formatIstDate } from '../common/time';
import { PassService } from '../passes/pass.service';
import { TENANT_PRISMA, TenantPrismaClient } from '../tenancy/tenant-prisma';
import { StorageService } from '../storage/storage.service';
import { InvalidTransitionError } from '../visits/errors';
import { VisitLifecycleService } from '../visits/visit-lifecycle.service';
import { VISIT_INCLUDE } from '../visits/visits.service';

const PASS_EARLY_GRACE_MIN = 30;
const GATE_VISIT_INCLUDE = { ...VISIT_INCLUDE, inGate: true } as const;
type GateVisit = Prisma.VisitGetPayload<{ include: typeof GATE_VISIT_INCLUDE }>;

export type ScanMode = 'IN' | 'OUT';

interface Action {
  gate: Gate;
  user: AuthUser;
  clientEventId: string;
  meta?: object;
}

@Injectable()
export class GateService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrismaClient,
    private readonly passes: PassService,
    private readonly lifecycle: VisitLifecycleService,
    private readonly storage: StorageService,
  ) {}

  async scan(user: AuthUser, input: { qr: string; gateId: string; mode: ScanMode; clientEventId: string }) {
    const gate = await this.requireGate(user, input.gateId);
    const replay = await this.replay(input.clientEventId, user.businessId);
    if (replay) return replay;

    const pass = this.passes.verify(input.qr);
    if (!pass) throw new ApiException(422, 'INVALID_PASS', 'This QR code is not valid.');
    if (pass.s !== gate.premisesId) throw new ApiException(422, 'WRONG_SITE', 'This pass is for a different premises.');

    const visit = await this.loadVisit(pass.v);
    const action = { gate, user, clientEventId: input.clientEventId };
    return input.mode === 'IN' ? this.checkIn(visit, action) : this.checkOut(visit, action);
  }

  /** Without a QR: walk-ins, or when the visitor's phone is off. */
  async manual(
    user: AuthUser,
    visitId: string,
    mode: ScanMode,
    input: { gateId: string; clientEventId: string },
  ) {
    const gate = await this.requireGate(user, input.gateId);
    const replay = await this.replay(input.clientEventId, user.businessId);
    if (replay) return replay;

    const visit = await this.loadVisit(visitId);
    if (visit.businessId !== user.businessId || !user.premisesIds.includes(visit.premisesId)) {
      throw new ApiException(403, 'FORBIDDEN', 'This visit is not at your premises.');
    }
    const action = { gate, user, clientEventId: input.clientEventId, meta: { method: 'manual' } };
    return mode === 'IN' ? this.checkIn(visit, action) : this.checkOut(visit, action);
  }

  private async checkIn(visit: GateVisit, action: Action) {
    // A retry of this same scan may have completed meanwhile: check that first, or we would wrongly say "already inside".
    if (visit.status !== 'APPROVED') {
      const replay = await this.replay(action.clientEventId, action.user.businessId);
      if (replay) return replay;
    }
    this.assertCanEnter(visit);
    try {
      await this.lifecycle.apply({
        visitId: visit.id,
        action: 'CHECK_IN',
        actorId: action.user.id,
        gateId: action.gate.id,
        deviceId: action.user.deviceId,
        clientEventId: action.clientEventId,
        meta: action.meta,
        patch: { checkedInAt: new Date(), inGateId: action.gate.id },
        notify: visit.hostId
          ? [
              {
                channel: 'PUSH',
                template: 'VISITOR_ARRIVED',
                recipient: visit.hostId,
                vars: { visitorName: visit.visitor.name, gateName: action.gate.name },
              },
            ]
          : [],
      });
    } catch (error) {
      return this.afterConflict(error, visit.id, action.clientEventId, action.user.businessId);
    }
    return this.result('CHECKED_IN', await this.loadVisit(visit.id));
  }

  private async checkOut(visit: GateVisit, action: Action) {
    // Visitors may always leave, even after the pass expires, so no time window check here.
    if (visit.status !== 'CHECKED_IN') {
      const replay = await this.replay(action.clientEventId, action.user.businessId);
      if (replay) return replay;
      throw new ApiException(409, 'NOT_CHECKED_IN', 'This visitor is not checked in.', { status: visit.status });
    }
    try {
      await this.lifecycle.apply({
        visitId: visit.id,
        action: 'CHECK_OUT',
        actorId: action.user.id,
        gateId: action.gate.id,
        deviceId: action.user.deviceId,
        clientEventId: action.clientEventId,
        meta: action.meta,
        patch: { checkedOutAt: new Date(), outGateId: action.gate.id },
      });
    } catch (error) {
      return this.afterConflict(error, visit.id, action.clientEventId, action.user.businessId);
    }
    return this.result('CHECKED_OUT', await this.loadVisit(visit.id));
  }

  private assertCanEnter(visit: GateVisit, now = new Date()): void {
    if (visit.status === 'CHECKED_IN') throw this.alreadyInside(visit);
    if (visit.status === 'EXPIRED' || (visit.status === 'APPROVED' && now > visit.validTo)) {
      throw new ApiException(422, 'PASS_EXPIRED', `This pass was valid for ${formatIstDate(visit.validTo)}`);
    }
    if (visit.status !== 'APPROVED') throw new InvalidTransitionError(visit.status);
    if (now.getTime() < visit.validFrom.getTime() - PASS_EARLY_GRACE_MIN * 60_000) {
      throw new ApiException(422, 'PASS_NOT_YET_VALID', 'This pass is not valid yet.');
    }
  }

  private alreadyInside(visit: GateVisit) {
    const gate = visit.inGate?.name ?? '';
    return new ApiException(409, 'ALREADY_CHECKED_IN', `This visitor already checked in at ${gate}.`, {
      at: visit.checkedInAt?.toISOString(),
      gate,
    });
  }

  /** Two requests raced and this one lost: success if it is a retry of the same scan, otherwise a clear error. */
  private async afterConflict(error: unknown, visitId: string, clientEventId: string, businessId: string | null) {
    const duplicate = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
    if (!duplicate && !(error instanceof InvalidTransitionError)) throw error;

    const replay = await this.replay(clientEventId, businessId);
    if (replay) return replay;
    const fresh = await this.loadVisit(visitId);
    if (fresh.status === 'CHECKED_IN') throw this.alreadyInside(fresh);
    // The id belonged to another business's event: reveal nothing about it.
    if (duplicate) throw usedRequestId();
    throw error;
  }

  private async replay(clientEventId: string, businessId: string | null) {
    const event = await this.prisma.visitEvent.findUnique({ where: { clientEventId } });
    // An event id from another business must never reveal its visit.
    if (!event || event.businessId !== businessId) return null;
    const visit = await this.loadVisit(event.visitId);
    return this.result(event.type === 'CHECK_OUT' ? 'CHECKED_OUT' : 'CHECKED_IN', visit);
  }

  async requireGate(user: AuthUser, gateId: string): Promise<Gate> {
    const gate = await this.prisma.gate.findUnique({ where: { id: gateId } });
    if (!gate) throw new ApiException(422, 'VALIDATION_FAILED', 'Gate not found.');
    if (gate.businessId !== user.businessId || !user.premisesIds.includes(gate.premisesId)) {
      throw new ApiException(403, 'FORBIDDEN', 'This gate is not at your premises.');
    }
    return gate;
  }

  private async loadVisit(id: string): Promise<GateVisit> {
    const visit = await this.prisma.visit.findUnique({ where: { id }, include: GATE_VISIT_INCLUDE });
    if (!visit) throw new ApiException(422, 'INVALID_PASS', 'Visit not found.');
    return visit;
  }

  private result(result: 'CHECKED_IN' | 'CHECKED_OUT', visit: GateVisit) {
    return {
      result,
      visitId: visit.id,
      visitor: {
        name: visit.visitor.name,
        company: visit.visitor.company,
        photoUrl: visit.visitor.photoKey ? this.storage.photoUrl(visit.visitor.photoKey) : null,
      },
      host: visit.host?.name ?? RECEPTION_DESK,
      validTo: visit.validTo.toISOString(),
    };
  }
}
