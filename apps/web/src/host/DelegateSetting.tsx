import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage, useApi } from '../api';
import { PageHeader } from '../ui/Page';
import { useAuth } from '../auth/AuthProvider';

export function DelegateSetting() {
  const api = useApi();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me.get() });
  const q = search.trim();
  const hosts = useQuery({
    queryKey: ['hosts', q],
    queryFn: () => api.users.searchHosts(q),
    enabled: q.length >= 2,
  });

  async function setDelegate(delegateId: string | null) {
    setError(null);
    try {
      queryClient.setQueryData(['me'], await api.me.update({ delegateId }));
      setSearch('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader title="Backup person" subtitle="When you are in a meeting or on leave, walk-in approvals go to this person." />
      <section className="form-card">
      <p className="muted">If you do not respond in time, the approval request goes to this person.</p>
      {me.data?.delegateName && (
        <div className="row">
          <span>Current backup: {me.data.delegateName}</span>
          <button type="button" onClick={() => void setDelegate(null)}>
            Remove backup
          </button>
        </div>
      )}
      <div className="stack">
        <label htmlFor="delegate-search">Search for a backup person</label>
        <input id="delegate-search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="row">
        {hosts.data
          ?.filter((host) => host.id !== user?.id)
          .map((host) => (
            <button type="button" key={host.id} onClick={() => void setDelegate(host.id)}>
              {host.name}
              {host.department ? ` (${host.department})` : ''}
            </button>
          ))}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      </section>
    </>
  );
}
