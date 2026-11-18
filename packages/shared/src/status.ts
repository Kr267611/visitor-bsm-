export const VISIT_STATUSES = [
  'INVITED',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'CHECKED_IN',
  'CHECKED_OUT',
  'CANCELLED',
  'EXPIRED',
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export type VisitAction =
  | 'REGISTER'
  | 'APPROVE'
  | 'REJECT'
  | 'CHECK_IN'
  | 'CHECK_OUT'
  | 'CANCEL'
  | 'EXPIRE';

const TRANSITIONS: Partial<Record<VisitStatus, Partial<Record<VisitAction, VisitStatus>>>> = {
  INVITED: { REGISTER: 'APPROVED', CANCEL: 'CANCELLED', EXPIRE: 'EXPIRED' },
  PENDING_APPROVAL: {
    APPROVE: 'APPROVED',
    REJECT: 'REJECTED',
    CANCEL: 'CANCELLED',
    EXPIRE: 'EXPIRED',
  },
  APPROVED: { CHECK_IN: 'CHECKED_IN', CANCEL: 'CANCELLED', EXPIRE: 'EXPIRED' },
  CHECKED_IN: { CHECK_OUT: 'CHECKED_OUT' },
};

export function nextStatus(from: VisitStatus, action: VisitAction): VisitStatus | null {
  return TRANSITIONS[from]?.[action] ?? null;
}

/** Human-readable status names for badges and lists (web and mobile use the same words). */
export const VISIT_STATUS_LABEL: Record<VisitStatus, string> = {
  INVITED: 'Invited',
  PENDING_APPROVAL: 'Pending approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CHECKED_IN: 'Checked in',
  CHECKED_OUT: 'Checked out',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};
