import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { errorMessage, useApi } from '../api';
import { StatusBadge } from '../ui/StatusBadge';

const WHEN = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Kolkata',
});

export function ApprovalPage() {
  const { id = '' } = useParams();
  const api = useApi();
  const queryClient = useQueryClient();
  const key = ['visit', id];
  const visit = useQuery({ queryKey: key, queryFn: () => api.visits.get(id) });
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  async function act(work: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await work();
      if (success) setMessage(success);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      // Refresh even on error: someone else may have decided first.
      await queryClient.invalidateQueries({ queryKey: key });
      await queryClient.invalidateQueries({ queryKey: ['visits'] });
    }
  }

  if (visit.isPending) return <p className="page-message">Loading…</p>;
  if (visit.isError) {
    return (
      <p role="alert" className="error">
        {errorMessage(visit.error)}
      </p>
    );
  }

  const v = visit.data;
  const pending = v.status === 'PENDING_APPROVAL';
  const open = v.status === 'INVITED' || v.status === 'APPROVED';
  const trimmed = note.trim() || undefined;

  return (
    <>
      <div className="spread">
        <h1>{v.visitorName}</h1>
        <Link to="/my">Back</Link>
      </div>
      <section className="form-card">
        <div className="row">
          <StatusBadge status={v.status} />
          <span className="mono muted">{v.code}</span>
        </div>
        {v.photoUrl && <img src={v.photoUrl} alt={v.visitorName} className="photo-preview" />}
        <dl className="pass-meta">
          <dt>Company</dt>
          <dd>{v.company ?? '-'}</dd>
          <dt>Purpose</dt>
          <dd>{v.purpose}</dd>
          <dt>From</dt>
          <dd>{WHEN.format(new Date(v.validFrom))}</dd>
          <dt>Until</dt>
          <dd>{WHEN.format(new Date(v.validTo))}</dd>
        </dl>
        {v.decisionNote && <p>Note: {v.decisionNote}</p>}
        {v.deliveryFailed && <p className="notice">The SMS could not be delivered. Use "Resend link" or call the visitor.</p>}

        {pending && (
          <>
            <div className="stack">
              <label htmlFor="decision-note">Note for the guard</label>
              <input id="decision-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="row">
              <button type="button" className="primary" disabled={busy} onClick={() => void act(() => api.visits.approve(id, trimmed))}>
                Approve
              </button>
              <button type="button" className="danger" disabled={busy} onClick={() => void act(() => api.visits.reject(id, trimmed))}>
                Reject
              </button>
            </div>
          </>
        )}

        {open && (
          <div className="row">
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => api.visits.resendInvite(id), 'New link sent. The old link no longer works.')}
            >
              Resend link
            </button>
            {!confirmCancel ? (
              <button type="button" className="danger" onClick={() => setConfirmCancel(true)}>
                Cancel visit
              </button>
            ) : (
              <div className="confirm">
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={() => {
                    setConfirmCancel(false);
                    void act(() => api.visits.cancel(id));
                  }}
                >
                  Yes, cancel
                </button>
                <button type="button" onClick={() => setConfirmCancel(false)}>
                  No
                </button>
              </div>
            )}
          </div>
        )}

        {message && <p>{message}</p>}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </section>
    </>
  );
}
