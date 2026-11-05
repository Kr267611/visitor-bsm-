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
