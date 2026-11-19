import { Inject, Injectable } from '@nestjs/common';
import { ApprovalTimerProcessor } from '../approvals/approval-timer.processor';
import { AuthUser } from '../auth/roles.decorator';
import { OtpService } from '../auth/otp.service';
import { ApiException } from '../common/api-exception';
import { requirePhone } from '../common/parse';
import { isUniqueViolation, usedRequestId } from '../common/records';
import { PlanLimits } from '../plans/plan-limits.service';
import { TENANT_PRISMA, TenantPrismaClient } from '../tenancy/tenant-prisma';
import { StorageService } from '../storage/storage.service';
import { VisitLifecycleService } from '../visits/visit-lifecycle.service';
import { GateService } from './gate.service';

const WALK_IN_WINDOW_MS = 4 * 60 * 60 * 1000;
const RETENTION_DAYS = 180;

export interface WalkInInput {
  phone: string;
  otp: string;
  name: string;
  company?: string;
  photoKey?: string;
  hostId: string;
  purpose: string;
  purposeNote?: string;
  gateId: string;
  consent: boolean;
  clientEventId: string;
}

@Injectable()
export class WalkInService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrismaClient,
    private readonly otp: OtpService,
    private readonly storage: StorageService,
    private readonly lifecycle: VisitLifecycleService,
    private readonly timers: ApprovalTimerProcessor,
    private readonly gates: GateService,
    private readonly limits: PlanLimits,
  ) {}

  async lookup(user: AuthUser, rawPhone: string) {
    const visitor = await this.prisma.visitor.findUnique({
      where: { businessId_phone: { businessId: user.businessId ?? '', phone: requirePhone(rawPhone) } },
    });
    if (!visitor) return { found: false };
    return {
      found: true,
      name: visitor.name,
      company: visitor.company,
      photoUrl: visitor.photoKey ? this.storage.photoUrl(visitor.photoKey) : null,
    };
  }

  async sendOtp(rawPhone: string): Promise<void> {
    await this.otp.request(requirePhone(rawPhone), 'WALKIN_OTP');
  }

  async create(user: AuthUser, input: WalkInInput) {
    // On retry return the same visit; do not ask for the OTP again.
    const earlier = await this.prisma.visitEvent.findUnique({
      where: { clientEventId: input.clientEventId },
      include: { visit: true },
    });
    if (earlier) return this.view(earlier.visit);

    const gate = await this.gates.requireGate(user, input.gateId);
    await this.limits.assert(gate.businessId, 'visits');
    const phone = requirePhone(input.phone);
    if (!input.consent) {
      throw new ApiException(422, 'CONSENT_REQUIRED', "Entry is not allowed without the visitor's consent.");
    }
    const host = await this.prisma.user.findFirst({
      where: {
        id: input.hostId,
        businessId: gate.businessId,
        isActive: true,
        premises: { some: { premisesId: gate.premisesId } },
      },
    });
    if (!host) {
      throw new ApiException(422, 'VALIDATION_FAILED', 'The host must be an active employee at this premises.');
    }
    const known = await this.prisma.visitor.findUnique({
      where: { businessId_phone: { businessId: gate.businessId, phone } },
    });
    const photoKey = await this.resolvePhoto(user, input.photoKey, known?.photoKey ?? null);

    // OTP is checked last, so other mistakes do not waste it.
    if (!(await this.otp.verify(phone, input.otp, 'WALKIN_OTP'))) {
      throw new ApiException(401, 'INVALID_OTP', 'Incorrect OTP.');
    }

    const consentAt = new Date();
    const details = {
      name: input.name,
      company: input.company,
      photoKey,
      consentAt,
      consentVersion: process.env.CONSENT_VERSION,
      deleteAfter: new Date(consentAt.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
    };
    const visitor = await this.prisma.visitor.upsert({
      where: { businessId_phone: { businessId: gate.businessId, phone } },
      update: details,
      create: { businessId: gate.businessId, phone, ...details },
    });

    const now = new Date();
    const visit = await this.lifecycle
      .create({
        data: {
          visitorId: visitor.id,
          hostId: host.id,
          businessId: gate.businessId,
          premisesId: gate.premisesId,
          type: 'WALKIN',
          purpose: input.purpose,
          purposeNote: input.purposeNote || null,
          status: 'PENDING_APPROVAL',
          validFrom: now,
          validTo: new Date(now.getTime() + WALK_IN_WINDOW_MS),
        },
        actorId: user.id,
        gateId: gate.id,
        deviceId: user.deviceId,
        clientEventId: input.clientEventId,
        notify: [
          {
            channel: 'PUSH',
            template: 'APPROVAL_REQUEST',
            recipient: host.id,
            vars: { visitorName: visitor.name, company: visitor.company ?? '-', purpose: input.purpose },
          },
        ],
      })
      .catch((error: unknown) => {
        // The id belonged to another business's event (our own would have been found above).
        throw isUniqueViolation(error) ? usedRequestId() : error;
      });
    await this.timers.schedule(visit.id);
    return this.view(visit);
  }

  private async resolvePhoto(user: AuthUser, key: string | undefined, existing: string | null): Promise<string> {
    if (!key) {
      if (existing) return existing;
      throw new ApiException(422, 'VALIDATION_FAILED', 'A photo is required for a new visitor.');
    }
    if (key === existing) return key;
    if (!key.startsWith(`uploads/${user.id}/`) || !(await this.storage.exists(key))) {
      throw new ApiException(422, 'VALIDATION_FAILED', 'Please upload the photo again.');
    }
    return key;
  }

  private view(visit: { id: string; code: string; status: string }) {
    return { visitId: visit.id, code: visit.code, status: visit.status };
  }
}
