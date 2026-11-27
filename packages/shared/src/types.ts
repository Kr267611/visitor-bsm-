export type Role = 'super_admin' | 'guard' | 'employee' | 'reception' | 'security' | 'admin';

import type { VisitStatus } from './status';

export interface VisitSummary {
  id: string;
  code: string;
  status: VisitStatus;
  visitorName: string;
  company: string | null;
  photoUrl: string | null;
  hostName: string;
  validFrom: string;
  validTo: string;
  checkedInAt: string | null;
  /** Kind of visit, chosen from the premises list. */
  purpose: string;
  /** What the visit is about, in the visitor's own words (QR self check-in, walk-in). */
  purposeNote: string | null;
}

export interface LiveDashboard {
  inside: VisitSummary[];
  expected: VisitSummary[];
  pending: VisitSummary[];
  needsCall: (VisitSummary & { hostPhone: string | null })[];
}

/** Counts for one dashboard card. Days and months are India time. */
export interface StatCount {
  today: number;
  month: number;
  total: number;
}

/** Exit slip for one visit: who, when in, when out, what they carried. Times are ISO. */
export interface GatePass {
  visitId: string;
  /** Null until the visitor checks out. */
  gatePassNo: string | null;
  visitCode: string;
  status: VisitStatus;
  businessName: string;
  premisesName: string;
  visitorName: string;
  company: string | null;
  phone: string;
  photoUrl: string | null;
  hostName: string;
  purpose: string;
  purposeNote: string | null;
  inAt: string | null;
  outAt: string | null;
  inGate: string | null;
  outGate: string | null;
  itemsOut: string | null;
  /** Who checked the visitor out. */
  checkedOutBy: string | null;
}

export type StatsPeriod = 'today' | 'month' | 'year';

/** Numbers for the premises dashboard. */
export interface DashboardStats {
  /** Visitors who came in (checked in at the gate). */
  visits: StatCount;
  /** Invites sent by hosts before the visit. */
  invites: StatCount;
  /** Walk-in and QR check-in requests. */
  walkIns: StatCount;
  /** Requests that were rejected. */
  rejected: StatCount;
  /** Different people who have visited. */
  totalVisitors: number;
  insideNow: number;
  waitingNow: number;
  /** Visits per host in the chosen period, most first. Null host is the reception desk. */
  hostWise: { name: string; count: number }[];
  period: StatsPeriod;
  /** Visits per month of `year`, January first. */
  monthWise: number[];
  year: number;
  /** Today's visits: arrivals and requests. */
  todayVisits: VisitSummary[];
}

export type ErrorCode =
  | 'RATE_LIMITED'
  | 'SMS_UNAVAILABLE'
  | 'INVALID_PASS'
  | 'WRONG_SITE'
  | 'PASS_NOT_YET_VALID'
  | 'PASS_EXPIRED'
  | 'ALREADY_CHECKED_IN'
  | 'NOT_CHECKED_IN'
  | 'INVALID_TRANSITION'
  | 'INVITE_EXPIRED'
  | 'CONSENT_REQUIRED'
  | 'INVALID_OTP'
  | 'OTP_RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INTERNAL'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'INVALID_CREDENTIALS'
  | 'LOGIN_LOCKED'
  | 'CHOOSE_BUSINESS'
  | 'PREMISES_FORBIDDEN'
  | 'FEATURE_RESTRICTED'
  | 'MODULE_FORBIDDEN'
  | 'PLAN_LIMIT'
  | 'PREMISES_UNAVAILABLE'
  | 'PREMISES_CLOSED'
  | 'LOCATION_REQUIRED'
  | 'OUTSIDE_PREMISES';
