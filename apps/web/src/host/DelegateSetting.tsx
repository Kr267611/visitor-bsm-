import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage, useApi } from '../api';
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
      <h1>Backup person</h1>
      <section className="form-card">
      <p className="muted">Aap jawab na de payein to approval is person ko jayega.</p>
      {me.data?.delegateName && (
        <div className="row">
          <span>Abhi backup: {me.data.delegateName}</span>
          <button type="button" onClick={() => void setDelegate(null)}>
            Backup hatayein
          </button>
        </div>
      )}
      <div className="stack">
        <label htmlFor="delegate-search">Backup person dhoondein</label>
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
