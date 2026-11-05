import { ApiError, PublicInvite, VisitStatus } from '@visitor/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { errorMessage, useApi } from '../api';
import { PassView } from './PassView';
import { VisitorForm } from './VisitorForm';

const MESSAGES: Partial<Record<VisitStatus, string>> = {
  CHECKED_OUT: 'Aapki visit poori ho gayi. Dhanyavaad.',
  CANCELLED: 'Yeh visit cancel ho gayi hai. Apne host se baat karein.',
  EXPIRED: 'Is link ka time khatam ho gaya hai. Apne host se naya link maangein.',
  REJECTED: 'Yeh visit approve nahi hui. Apne host se baat karein.',
  PENDING_APPROVAL: 'Host ke jawab ka intezaar hai. Guard aapko batayenge.',
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
    body = <p className="page-message">Load ho raha hai…</p>;
  } else if (query.isError) {
    body =
      query.error instanceof ApiError && query.error.status === 404 ? (
        <p className="page-message">Yeh link sahi nahi hai. Apne host se naya link maangein.</p>
      ) : (
        <div className="stack">
          <p role="alert" className="error">
            {errorMessage(query.error)}
          </p>
          <button type="button" onClick={() => void query.refetch()}>
            Dobara koshish karein
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
