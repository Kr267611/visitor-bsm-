import type { AdminUser, Role } from '@visitor/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { errorMessage, useApi } from '../api';

const ROLES: { value: Role; label: string }[] = [
  { value: 'guard', label: 'Guard' },
  { value: 'employee', label: 'Employee' },
  { value: 'reception', label: 'Reception' },
  { value: 'security', label: 'Security' },
  { value: 'admin', label: 'Admin' },
];

function ActiveToggle({ user }: { user: AdminUser }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setActive(isActive: boolean) {
    setError(null);
    try {
      await api.admin.users.update(user.id, { isActive });
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!user.isActive) {
    return (
      <div className="row">
        <span className="badge badge-neutral">Band hai</span>
        <button type="button" onClick={() => void setActive(true)}>
          Chalu karein
        </button>
      </div>
    );
  }
  return (
    <div className="row">
      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)}>
          Band karein
        </button>
      ) : (
        <>
          <button type="button" className="danger" onClick={() => void setActive(false)}>
            Haan, band karein
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            Nahi
          </button>
        </>
      )}
      {error && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </div>
  );
}

export function UsersPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api.admin.users.list() });
  const sites = useQuery({ queryKey: ['admin', 'sites'], queryFn: () => api.admin.sites.list() });
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<Role>('employee');
  const [siteId, setSiteId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.admin.users.create({ name: name.trim(), phone, role, siteId });
      setName('');
      setPhone('');
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Users</h1>
      <form className="form-card" onSubmit={create}>
        <h2>Naya user</h2>
        <div className="form-grid">
          <div>
            <label htmlFor="user-name">Naam</label>
            <input id="user-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="user-phone">Mobile</label>
            <input id="user-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="user-role">Role</label>
            <select id="user-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="user-site">Site</label>
            <select id="user-site" value={siteId} onChange={(e) => setSiteId(e.target.value)} required>
              <option value="">Chunein</option>
              {sites.data?.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy}>
          User banayein
        </button>
      </form>

      {users.isError && (
        <p role="alert" className="error">
          {errorMessage(users.error)}
        </p>
      )}
      <section className="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>Naam</th>
              <th>Mobile</th>
              <th>Role</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {users.data?.map((user) => (
              <tr key={user.id}>
                <td>{user.name}</td>
                <td className="mono">{user.phone}</td>
                <td>{user.role}</td>
                <td>
                  <ActiveToggle user={user} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
