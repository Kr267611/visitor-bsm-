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
}

export interface LiveDashboard {
  inside: VisitSummary[];
  expected: VisitSummary[];
  pending: VisitSummary[];
  needsCall: (VisitSummary & { hostPhone: string })[];
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
  | 'PLAN_LIMIT';
