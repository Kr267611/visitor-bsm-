import type { VisitSummary } from '@visitor/shared';
import { ReactNode } from 'react';
import { StatusBadge } from '../ui/StatusBadge';

const TIME = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

export function VisitRow({ visit, children, note }: { visit: VisitSummary; children?: ReactNode; note?: ReactNode }) {
  return (
    <div className="visit-row">
      {visit.photoUrl ? (
        <img src={visit.photoUrl} alt="" className="visit-photo" />
      ) : (
        <div className="visit-photo" aria-hidden="true" />
      )}
      <div className="visit-main">
        <strong>{visit.visitorName}</strong>
        <span className="muted">
          {visit.company ? `${visit.company} · ` : ''}Host: {visit.hostName}
        </span>
        {visit.purpose && (
          <span className="visit-purpose">
            <strong>{visit.purpose}</strong>
            {visit.purposeNote ? ` — ${visit.purposeNote}` : ''}
          </span>
        )}
        <span className="mono muted">
          {visit.code} · {visit.checkedInAt ? `In since ${TIME.format(new Date(visit.checkedInAt))}` : `${TIME.format(new Date(visit.validFrom))} – ${TIME.format(new Date(visit.validTo))}`}
        </span>
        {note}
      </div>
      <StatusBadge status={visit.status} />
      {children && <div className="visit-actions">{children}</div>}
    </div>
  );
}
