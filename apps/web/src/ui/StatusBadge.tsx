import type { VisitStatus } from '@visitor/shared';

const TONE: Record<VisitStatus, string> = {
  INVITED: 'neutral',
  PENDING_APPROVAL: 'wait',
  APPROVED: 'good',
  REJECTED: 'bad',
  CHECKED_IN: 'good',
  CHECKED_OUT: 'neutral',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
};

export const STATUS_LABEL: Record<VisitStatus, string> = {
  INVITED: 'Invited',
  PENDING_APPROVAL: 'Pending approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CHECKED_IN: 'Checked in',
  CHECKED_OUT: 'Checked out',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

export function StatusBadge({ status }: { status: VisitStatus }) {
  return <span className={`badge badge-${TONE[status]}`}>{STATUS_LABEL[status] ?? status}</span>;
}
