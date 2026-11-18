import { VISIT_STATUS_LABEL, type VisitStatus } from '@visitor/shared';

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

/** Same words on web and mobile. */
export const STATUS_LABEL = VISIT_STATUS_LABEL;

export function StatusBadge({ status }: { status: VisitStatus }) {
  return <span className={`badge badge-${TONE[status]}`}>{STATUS_LABEL[status] ?? status}</span>;
}
