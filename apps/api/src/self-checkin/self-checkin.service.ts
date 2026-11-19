import { randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { VisitStatus } from '@prisma/client';
import { ApprovalTimerProcessor } from '../approvals/approval-timer.processor';
import { OtpService } from '../auth/otp.service';
import { ApiException } from '../common/api-exception';
import { distanceMetres, istClock } from '../common/time';
import { OutboxDraft } from '../notifications/templates';
import { PlanLimits } from '../plans/plan-limits.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { runInTenant } from '../tenancy/request-context';
import { inviteLink, newInviteToken } from '../visits/invite-tokens';
import { VisitLifecycleService } from '../visits/visit-lifecycle.service';

const AUDIENCE = 'self-checkin';
const SESSION_TTL = '20m';
const RETENTION_DAYS = 180;
/** At most this much GPS inaccuracy is credited when checking the geofence. */
const MAX_ACCURACY_CREDIT_M = 100;
/** Visits that count as "already here": scanning again shows these instead of creating a new one. */
const ACTIVE: VisitStatus[] = ['INVITED', 'PENDING_APPROVAL', 'APPROVED', 'CHECKED_IN'];
const HOST_ROLES = ['employee', 'reception', 'security', 'admin'] as const;

export interface Location {
  lat: number;
  lng: number;
  accuracy?: number;
}

export interface Session {
  phone: string;
  premisesId: string;
  businessId: string;
  sid: string;
}

export interface CheckInInput {
  name: string;
  company?: string;
  purpose: string;
  purposeNote: string;
  hostId: string;
  photoKey?: string;
  consent: boolean;
  location?: Location;
}

type LoadedPremises = NonNullable<Awaited<ReturnType<SelfCheckInService['find']>>>;

const unavailable = () =>
  new ApiException(503, 'PREMISES_UNAVAILABLE', 'Visitor check-in is currently unavailable here. Please contact reception.');

/**
 * Visitor self check-in from the QR poster at a premises. The poster only starts the flow:
 * entry still needs OTP on the visitor's phone, host approval (when required) and a signed pass at the gate.
 * Lookups by slug use the raw client; every write runs inside the premises' business.
 */
@Injectable()
export class SelfCheckInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly otp: OtpService,
    private readonly storage: StorageService,
    private readonly lifecycle: VisitLifecycleService,
    private readonly timers: ApprovalTimerProcessor,
    private readonly limits: PlanLimits,
  ) {}

  find(businessSlug: string, premisesSlug: string) {
    return this.prisma.premises.findFirst({
      where: { webSlug: premisesSlug, business: { slug: businessSlug } },
      include: { business: { include: { plan: true } }, setting: true },
    });
  }

  private async load(businessSlug: string, premisesSlug: string): Promise<LoadedPremises> {
    const premises = await this.find(businessSlug, premisesSlug);
    if (!premises) throw new ApiException(404, 'NOT_FOUND', 'This check-in link is not valid.');
    return premises;
  }

  /** open | closed (outside visiting hours) | unavailable (business off, module not in plan, visit limit reached). */
  private async availability(p: LoadedPremises): Promise<'open' | 'closed' | 'unavailable'> {
    if (!p.business.isActive || !p.business.plan.features.includes('visitor_desk')) return 'unavailable';
    try {
      await this.limits.assert(p.businessId, 'visits');
    } catch {
      return 'unavailable';
    }
    const start = p.setting?.visitStart;
    const end = p.setting?.visitEnd;
    const now = istClock();
    if ((start && now < start) || (end && now >= end)) return 'closed';
    return 'open';
  }

  private async assertOpen(p: LoadedPremises) {
    const state = await this.availability(p);
    if (state === 'unavailable') throw unavailable();
    if (state === 'closed') {
      const hours = `${p.setting?.visitStart ?? '00:00'}–${p.setting?.visitEnd ?? '24:00'}`;
      throw new ApiException(403, 'PREMISES_CLOSED', `Check-in is open only during visiting hours (${hours}).`);
    }
  }

  /** With a geofence, the position (minus a capped accuracy credit) must fall inside the radius. */
  private assertLocation(p: LoadedPremises, location?: Location) {
    if (p.lat == null || p.lng == null || !p.geofenceM) return;
    if (!location) {
      throw new ApiException(422, 'LOCATION_REQUIRED', 'Please allow location access to check in at this premises.');
    }
    const credit = Math.min(Math.max(location.accuracy ?? 0, 0), MAX_ACCURACY_CREDIT_M);
    if (distanceMetres(location, { lat: p.lat, lng: p.lng }) - credit > p.geofenceM) {
      throw new ApiException(403, 'OUTSIDE_PREMISES', 'You need to be at the premises to check in.');
    }
  }

  async info(businessSlug: string, premisesSlug: string) {
    const p = await this.load(businessSlug, premisesSlug);
    return {
      businessName: p.business.name,
      premisesName: p.name,
      purposes: p.purposes,
      needsLocation: p.lat != null && p.lng != null && !!p.geofenceM,
      status: await this.availability(p),
      visitStart: p.setting?.visitStart ?? null,
      visitEnd: p.setting?.visitEnd ?? null,
    };
  }

  async sendOtp(businessSlug: string, premisesSlug: string, phone: string) {
    await this.assertOpen(await this.load(businessSlug, premisesSlug));
    await this.otp.request(phone, 'SELF_CHECKIN_OTP');
  }

  async verify(businessSlug: string, premisesSlug: string, phone: string, otp: string, location?: Location) {
    const p = await this.load(businessSlug, premisesSlug);
    await this.assertOpen(p);
    this.assertLocation(p, location);
    if (!(await this.otp.verify(phone, otp, 'SELF_CHECKIN_OTP'))) {
      throw new ApiException(401, 'INVALID_OTP', 'Incorrect OTP.');
    }
    const session: Session = { phone, premisesId: p.id, businessId: p.businessId, sid: randomBytes(12).toString('base64url') };
    const sessionToken = await this.jwt.signAsync(
      { sub: phone, p: p.id, b: p.businessId, sid: session.sid },
      { audience: AUDIENCE, expiresIn: SESSION_TTL },
    );
    const visitor = await this.prisma.visitor.findUnique({
      where: { businessId_phone: { businessId: p.businessId, phone } },
    });
    return {
      sessionToken,
      visitor: visitor ? { name: visitor.name, company: visitor.company, hasPhoto: !!visitor.photoKey } : null,
      activeVisit: await this.activeVisitLink(session),
    };
  }

  /** Reads and checks a session token; it must belong to this premises. */
  async session(businessSlug: string, premisesSlug: string, token: string | undefined): Promise<{ p: LoadedPremises; s: Session }> {
    const p = await this.load(businessSlug, premisesSlug);
    let payload: { sub: string; p: string; b: string; sid: string };
    try {
      payload = await this.jwt.verifyAsync(token ?? '', { audience: AUDIENCE });
    } catch {
      throw new ApiException(401, 'UNAUTHORIZED', 'Your check-in session has expired. Please verify your number again.');
    }
    if (payload.p !== p.id || payload.b !== p.businessId) {
      throw new ApiException(401, 'UNAUTHORIZED', 'Your check-in session has expired. Please verify your number again.');
    }
    return { p, s: { phone: payload.sub, premisesId: payload.p, businessId: payload.b, sid: payload.sid } };
  }

  private activeVisit(s: Session) {
    return this.prisma.visit.findFirst({
      where: {
        businessId: s.businessId,
        premisesId: s.premisesId,
        visitor: { phone: s.phone },
        status: { in: ACTIVE },
        OR: [{ status: 'CHECKED_IN' }, { validTo: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * The visitor proved the phone with OTP, so they may get a fresh link to their own active visit.
   * The old link stops working; the new one shows the pass, the form or the status.
   */
  private async activeVisitLink(s: Session) {
    const visit = await this.activeVisit(s);
    if (!visit) return null;
    const { token, hash } = newInviteToken();
    await this.prisma.visit.update({ where: { id: visit.id }, data: { inviteTokenHash: hash } });
    return { status: visit.status, token };
  }

  /**
   * People a visitor can ask to meet at this premises: name, department and designation only (never a phone).
   * The visitor picks a department, then a person; an empty search lists everyone.
   */
  hosts(p: LoadedPremises, q: string) {
    return this.prisma.user
      .findMany({
        where: {
          businessId: p.businessId,
          isActive: true,
          isHost: true,
          role: { in: [...HOST_ROLES] },
          ...(q && { name: { contains: q, mode: 'insensitive' } }),
          premises: { some: { premisesId: p.id } },
        },
        select: { id: true, name: true, designation: true, department: { select: { name: true } } },
        orderBy: { name: 'asc' },
        take: q ? 20 : 500,
      })
      .then((rows) =>
        rows.map((r) => ({ id: r.id, name: r.name, department: r.department?.name ?? null, designation: r.designation })),
      );
  }

  photoPrefix(s: Session) {
    return `self/${s.premisesId}/${s.sid}/`;
  }

  async savePhoto(s: Session, body: Buffer) {
    const key = `${this.photoPrefix(s)}${randomUUID()}.jpg`;
    await this.storage.put(key, body, 'image/jpeg');
    return { key };
  }

  async checkIn(p: LoadedPremises, s: Session, input: CheckInInput) {
    await this.assertOpen(p);
    this.assertLocation(p, input.location);
    // Scanning again never creates a second visit: hand back the one that already exists.
    const existing = await this.activeVisitLink(s);
    if (existing) return { ...existing, existing: true };

    if (!input.consent) {
      throw new ApiException(422, 'CONSENT_REQUIRED', 'Please give consent to continue.');
    }
    const host = await this.prisma.user.findFirst({
      where: {
        id: input.hostId,
        businessId: p.businessId,
        isActive: true,
        isHost: true,
        premises: { some: { premisesId: p.id } },
      },
    });
    if (!host) throw new ApiException(422, 'VALIDATION_FAILED', 'Please choose a host from this premises.');

    const known = await this.prisma.visitor.findUnique({
      where: { businessId_phone: { businessId: p.businessId, phone: s.phone } },
    });
    let photoKey = known?.photoKey ?? null;
    if (input.photoKey) {
      if (!input.photoKey.startsWith(this.photoPrefix(s)) || !(await this.storage.exists(input.photoKey))) {
        throw new ApiException(422, 'VALIDATION_FAILED', 'Please upload the photo again.');
      }
      photoKey = input.photoKey;
    }
    if (!photoKey) throw new ApiException(422, 'VALIDATION_FAILED', 'A photo is required for a new visitor.');

    const needsApproval = p.setting?.checkinOnApproval ?? true;
    const now = new Date();
    const validTo = new Date(now.getTime() + (p.setting?.defaultVisitMin ?? 240) * 60_000);
    const { token, hash } = newInviteToken();
    const link = inviteLink(token);
    const details = {
      name: input.name,
      company: input.company,
      photoKey,
      consentAt: now,
      consentVersion: process.env.CONSENT_VERSION,
      deleteAfter: new Date(now.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
    };

    const visit = await runInTenant(p.businessId, async () => {
      const visitor = await this.prisma.visitor.upsert({
        where: { businessId_phone: { businessId: p.businessId, phone: s.phone } },
        update: details,
        create: { businessId: p.businessId, phone: s.phone, ...details },
      });
      const notify: OutboxDraft[] = needsApproval
        ? [
            {
              channel: 'PUSH',
              template: 'APPROVAL_REQUEST',
              recipient: host.id,
              vars: { visitorName: visitor.name, company: visitor.company ?? '-', purpose: input.purpose },
            },
            {
              channel: 'SMS',
              template: 'SELF_CHECKIN_LINK',
              recipient: s.phone,
              vars: { siteName: p.name, hostName: host.name, link },
            },
          ]
        : [{ channel: 'SMS', template: 'PASS_READY', recipient: s.phone, vars: { link } }];
      return this.lifecycle.create({
        data: {
          visitorId: visitor.id,
          hostId: host.id,
          businessId: p.businessId,
          premisesId: p.id,
          type: 'SELF',
          purpose: input.purpose,
          purposeNote: input.purposeNote,
          status: needsApproval ? 'PENDING_APPROVAL' : 'APPROVED',
          validFrom: now,
          validTo,
          inviteTokenHash: hash,
        },
        actorId: null,
        notify,
      });
    });
    if (needsApproval) await this.timers.schedule(visit.id);
    return { status: visit.status, token, existing: false };
  }

  /** Self check-out: the visitor scans the premises QR again on the way out. */
  async checkOut(p: LoadedPremises, s: Session) {
    const visit = await this.prisma.visit.findFirst({
      where: { businessId: p.businessId, premisesId: p.id, visitor: { phone: s.phone }, status: 'CHECKED_IN' },
      orderBy: { checkedInAt: 'desc' },
    });
    if (!visit) throw new ApiException(409, 'NOT_CHECKED_IN', 'You are not checked in at this premises.');
    const updated = await runInTenant(p.businessId, () =>
      this.lifecycle.apply({
        visitId: visit.id,
        action: 'CHECK_OUT',
        actorId: null,
        meta: { method: 'self' },
        patch: { checkedOutAt: new Date() },
      }),
    );
    return { status: updated.status };
  }
}
