import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { errorMessage, useApi } from '../api';
import { useAuth } from '../auth/AuthProvider';
import { StatusBadge } from '../ui/StatusBadge';
import { DelegateSetting } from './DelegateSetting';

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
  const visits = useQuery({ queryKey: ['visits', 'mine'], queryFn: () => api.visits.list({ scope: 'mine' }) });

  return (
    <>
      <div className="spread">
        <h1>Mere visitors</h1>
        {user?.role !== 'security' && (
          <Link to="/my/invite" className="button-link">
            Naya invite
          </Link>
        )}
      </div>

      {visits.isError && (
        <p role="alert" className="error">
          {errorMessage(visits.error)}
        </p>
      )}

      {visits.data && (
        <section className="panel">
          {visits.data.length === 0 && <p className="empty">Abhi koi visitor nahi hai. "Naya invite" se shuru karein.</p>}
          {visits.data.map((visit) => (
            <div className="visit-row" key={visit.id}>
              <div className="visit-main">
                <Link to={`/my/visits/${visit.id}`}>
                  <strong>{visit.visitorName}</strong>
                </Link>
                <span className="muted">{WHEN.format(new Date(visit.validFrom))}</span>
              </div>
              <StatusBadge status={visit.status} />
            </div>
          ))}
        </section>
      )}

      <DelegateSetting />
    </>
  );
}
