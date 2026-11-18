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
  PENDING_APPROVAL: 'Waiting for your host to respond. The guard will let you know.',
};

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
  } else {
    body = <p className="page-message">{MESSAGES[query.data.status]}</p>;
  }

  return (
    <main className="visitor-page">
      <div className="visitor-card">{body}</div>
    </main>
  );
}
