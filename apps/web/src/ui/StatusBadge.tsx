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

export function StatusBadge({ status }: { status: VisitStatus }) {
  return <span className={`badge badge-${TONE[status]}`}>{status}</span>;
}
