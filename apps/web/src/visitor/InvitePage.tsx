import { ApiError, PublicInvite, VisitStatus } from '@visitor/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { errorMessage, useApi } from '../api';
import { PassView } from './PassView';
import { VisitorForm } from './VisitorForm';

const MESSAGES: Partial<Record<VisitStatus, string>> = {
  CHECKED_OUT: 'Your visit is complete. Thank you.',
  CANCELLED: 'This visit has been cancelled. Please contact your host.',
  EXPIRED: 'This link has expired. Please ask your host for a new one.',
  REJECTED: 'This visit was not approved. Please contact your host.',
  PENDING_APPROVAL: 'Waiting for your host to respond. This page updates by itself.',
};

const WAITING_POLL_MS = 4_000;

/** Shown while the host decides. The page polls and turns into the pass on approval. */
function WaitingCard({ invite }: { invite: PublicInvite }) {
  return (
    <section className="pass-card status-card" aria-live="polite">
      <div className="eyebrow">{invite.siteName}</div>
      <span className="pulse" aria-hidden="true" />
      <div className="pass-name">Waiting for {invite.hostName}</div>
      <p className="muted">{MESSAGES.PENDING_APPROVAL}</p>
      <dl className="pass-meta">
        <dt>Visitor</dt>
        <dd>{invite.visitorName}</dd>
        <dt>Host</dt>
        <dd>{invite.hostName}</dd>
      </dl>
      <p className="muted small">You can close this page: the same link was sent to you by SMS.</p>
    </section>
  );
}

export function InvitePage() {
  const { token = '' } = useParams();
  const api = useApi();
  const queryClient = useQueryClient();
  const key = ['public-invite', token];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.publicInvites.get(token),
    retry: false,
    refetchOnWindowFocus: false,
    // Waiting screen: turns into the pass as soon as the host approves.
    refetchInterval: (q) => (q.state.data?.status === 'PENDING_APPROVAL' ? WAITING_POLL_MS : false),
  });

  let body;
  if (query.isPending) {
    body = <p className="page-message">Loading…</p>;
  } else if (query.isError) {
    body =
      query.error instanceof ApiError && query.error.status === 404 ? (
        <p className="page-message">This link is not valid. Please ask your host for a new one.</p>
      ) : (
        <div className="stack">
          <p role="alert" className="error">
            {errorMessage(query.error)}
          </p>
          <button type="button" onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
      );
  } else if (query.data.status === 'INVITED') {
    body = (
      <VisitorForm
        token={token}
        invite={query.data}
        onDone={(invite: PublicInvite) => queryClient.setQueryData(key, invite)}
      />
    );
  } else if (query.data.pass) {
    body = <PassView invite={query.data} />;
  } else if (query.data.status === 'PENDING_APPROVAL') {
    body = <WaitingCard invite={query.data} />;
  } else {
    body = <p className="page-message">{MESSAGES[query.data.status]}</p>;
  }

  return (
    <main className="visitor-page">
      <div className="visitor-card">{body}</div>
    </main>
  );
}
