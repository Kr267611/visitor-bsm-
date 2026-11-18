import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { errorMessage, useApi } from '../api';
import { useAuth } from '../auth/AuthProvider';
import { useFeature } from '../ui/Layout';
import { EmptyState, PageHeader } from '../ui/Page';
import { StatusBadge } from '../ui/StatusBadge';

const WHEN = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Kolkata',
});

export function MyVisitsPage() {
  const api = useApi();
  const { user } = useAuth();
  const has = useFeature();
  const visits = useQuery({ queryKey: ['visits', 'mine'], queryFn: () => api.visits.list({ scope: 'mine' }) });
  const canInvite = user?.role !== 'security' && has('invites');
  const inviteButton = canInvite ? (
    <Link to="/my/invite" className="button-link">
      + New invite
    </Link>
  ) : null;

  return (
    <>
      <PageHeader
        title="My visitors"
        subtitle="People you invited or who came to meet you. Open a name for details and approval."
        actions={inviteButton}
      />

      {visits.isError && (
        <p role="alert" className="error">
          {errorMessage(visits.error)}
        </p>
      )}

      {visits.data && (
        <section className="panel">
          {visits.data.length === 0 && (
            <EmptyState
              title="No visitors yet."
              hint="Expecting someone? Send an invite: they get an SMS link and a QR pass for the gate."
              action={inviteButton}
            />
          )}
          {visits.data.map((visit) => (
            <div className="visit-row" key={visit.id}>
              <div className="visit-main">
                <Link to={`/my/visits/${visit.id}`}>
                  <strong>{visit.visitorName}</strong>
                </Link>
                <span className="muted small">{WHEN.format(new Date(visit.validFrom))}</span>
              </div>
              <StatusBadge status={visit.status} />
            </div>
          ))}
        </section>
      )}
    </>
  );
}
