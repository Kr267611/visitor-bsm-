import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { errorMessage, useApi } from '../api';

export function SitesPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const sites = useQuery({ queryKey: ['admin', 'sites'], queryFn: () => api.admin.sites.list() });
  const gates = useQuery({ queryKey: ['admin', 'gates'], queryFn: () => api.admin.gates.list() });
  const [siteName, setSiteName] = useState('');
  const [gateSite, setGateSite] = useState('');
  const [gateName, setGateName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function run(work: () => Promise<unknown>, reset: () => void) {
    setError(null);
    try {
      await work();
      reset();
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function addSite(event: FormEvent) {
    event.preventDefault();
    void run(() => api.admin.sites.create({ name: siteName.trim() }), () => setSiteName(''));
  }

  function addGate(event: FormEvent) {
    event.preventDefault();
    void run(() => api.admin.gates.create({ siteId: gateSite, name: gateName.trim() }), () => setGateName(''));
  }

  return (
    <>
      <h1>Sites aur gates</h1>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="desk-grid">
        <form className="form-card" onSubmit={addSite}>
          <h2>Nayi site</h2>
          <div className="stack">
            <label htmlFor="site-name">Site ka naam</label>
            <input id="site-name" value={siteName} onChange={(e) => setSiteName(e.target.value)} required />
          </div>
          <button type="submit">Site jodein</button>
        </form>
        <form className="form-card" onSubmit={addGate}>
          <h2>Naya gate</h2>
          <div className="stack">
            <label htmlFor="gate-site">Gate ki site</label>
            <select id="gate-site" value={gateSite} onChange={(e) => setGateSite(e.target.value)} required>
              <option value="">Chunein</option>
              {sites.data?.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
            <label htmlFor="gate-name">Gate ka naam</label>
            <input id="gate-name" value={gateName} onChange={(e) => setGateName(e.target.value)} required />
          </div>
          <button type="submit">Gate jodein</button>
        </form>
      </div>
      <section className="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>Site</th>
              <th>Gates</th>
            </tr>
          </thead>
          <tbody>
            {sites.data?.map((site) => (
              <tr key={site.id}>
                <td>{site.name}</td>
                <td>
                  {gates.data
                    ?.filter((gate) => gate.siteId === site.id)
                    .map((gate) => gate.name)
                    .join(', ') || '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
