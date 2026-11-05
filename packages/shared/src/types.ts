export type Role = 'guard' | 'employee' | 'reception' | 'security' | 'admin';

export type ErrorCode =
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
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED';
