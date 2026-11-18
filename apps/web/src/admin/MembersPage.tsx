import type { AdminUser, MemberInput, Role } from '@visitor/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { errorMessage, useApi } from '../api';
import { EmptyState, PageHeader, ROLE_LABEL } from '../ui/Page';

const ROLES: { value: Role; label: string }[] = [
  { value: 'guard', label: 'Guard' },
  { value: 'employee', label: 'Employee' },
  { value: 'reception', label: 'Reception' },
  { value: 'security', label: 'Security' },
  { value: 'admin', label: 'Admin' },
];
const KEY = ['admin', 'users'];

function ActiveToggle({ member }: { member: AdminUser }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setActive(isActive: boolean) {
    setError(null);
    try {
      await api.admin.users.update(member.id, { isActive });
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: KEY });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="row">
      {!member.isActive ? (
        <>
          <span className="badge badge-neutral">Inactive</span>
          <button type="button" onClick={() => void setActive(true)}>
            Activate
          </button>
        </>
      ) : !confirming ? (
        <button type="button" onClick={() => setConfirming(true)}>
          Deactivate
        </button>
      ) : (
        <>
          <button type="button" className="danger" onClick={() => void setActive(false)}>
            Yes, deactivate
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            No
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

/** Admin sets a new password; the member is signed out of all devices. */
function PasswordReset({ member }: { member: AdminUser }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      await api.admin.users.resetPassword(member.id, password);
      setPassword('');
      setOpen(false);
      setMessage({ ok: true, text: 'New password set. The member has been signed out of other devices.' });
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
    }
  }

  return (
    <div className="stack">
      {open ? (
        <form className="row" onSubmit={save}>
          <input
            type="password"
            aria-label={`New password for ${member.name}`}
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button type="submit">Set</button>
          <button type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)}>
          Password reset
        </button>
      )}
      {message && (
        <span role={message.ok ? 'status' : 'alert'} className={message.ok ? 'muted' : 'error'}>
          {message.text}
        </span>
      )}
    </div>
  );
}

const EMPTY = { name: '', phone: '', email: '', role: 'employee' as Role, departmentId: '', designation: '', password: '', isHost: true };

export function MembersPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const members = useQuery({ queryKey: KEY, queryFn: () => api.admin.users.list() });
  const premises = useQuery({ queryKey: ['admin', 'premises'], queryFn: () => api.admin.premises.list() });
  const departments = useQuery({ queryKey: ['admin', 'departments'], queryFn: () => api.admin.departments.list() });
  const [form, setForm] = useState(EMPTY);
  const [premisesIds, setPremisesIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const shown = (members.data ?? []).filter(
    (m) => !q || m.name.toLowerCase().includes(q) || m.phone.includes(q) || (m.email ?? '').toLowerCase().includes(q),
  );
  const set = (patch: Partial<typeof EMPTY>) => setForm({ ...form, ...patch });
  const togglePremises = (id: string) =>
    setPremisesIds(premisesIds.includes(id) ? premisesIds.filter((p) => p !== id) : [...premisesIds, id]);
  const premisesName = (id: string) => premises.data?.find((p) => p.id === id)?.name ?? '?';
  const departmentName = (id: string | null) => departments.data?.find((d) => d.id === id)?.name ?? '-';

  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!premisesIds.length) return setError('Select at least one premises.');
    const body: MemberInput = {
      name: form.name.trim(),
      phone: form.phone,
      role: form.role,
      premisesIds,
      isHost: form.isHost,
      ...(form.email.trim() && { email: form.email.trim() }),
      ...(form.departmentId && { departmentId: form.departmentId }),
      ...(form.designation.trim() && { designation: form.designation.trim() }),
      ...(form.password && { password: form.password }),
    };
    setBusy(true);
    try {
      await api.admin.users.create(body);
      setForm(EMPTY);
      setPremisesIds([]);
      setAdding(false);
      await queryClient.invalidateQueries({ queryKey: KEY });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Members"
        subtitle="People in your business: guards, reception, employees and admins. Each member needs at least one premises."
        actions={
          <button type="button" className="primary" aria-expanded={adding} onClick={() => setAdding(!adding)}>
            {adding ? 'Close form' : '+ New member'}
          </button>
        }
      />
      {adding && (
        <form className="form-card" onSubmit={create}>
          <h2>New member</h2>
          <div className="form-grid">
            <div>
              <label htmlFor="m-name">Name</label>
              <input id="m-name" value={form.name} onChange={(e) => set({ name: e.target.value })} required />
            </div>
            <div>
              <label htmlFor="m-phone">Mobile</label>
              <input id="m-phone" inputMode="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} required />
            </div>
            <div>
              <label htmlFor="m-email">Email</label>
              <input id="m-email" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
            </div>
            <div>
              <label htmlFor="m-role">Role</label>
              <select id="m-role" value={form.role} onChange={(e) => set({ role: e.target.value as Role })}>
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="m-dept">Department</label>
              <select id="m-dept" value={form.departmentId} onChange={(e) => set({ departmentId: e.target.value })}>
                <option value="">None</option>
                {departments.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="m-designation">Designation</label>
              <input id="m-designation" value={form.designation} onChange={(e) => set({ designation: e.target.value })} />
            </div>
            <div>
              <label htmlFor="m-password">Password (optional)</label>
              <input
                id="m-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={form.password}
                onChange={(e) => set({ password: e.target.value })}
              />
            </div>
          </div>
          <fieldset className="stack">
            <legend>Premises</legend>
            {premises.data?.map((p) => (
              <label key={p.id} className="row">
                <input type="checkbox" checked={premisesIds.includes(p.id)} onChange={() => togglePremises(p.id)} />
                {p.name}
              </label>
            ))}
          </fieldset>
          <label className="row">
            <input type="checkbox" checked={form.isHost} onChange={(e) => set({ isHost: e.target.checked })} />
            Visitors can meet this person (host)
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button type="submit" className="primary" disabled={busy}>
              Create member
            </button>
            <button type="button" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="toolbar">
        <div className="search">
          <label htmlFor="m-search">Search members</label>
          <input
            id="m-search"
            type="search"
            placeholder="Name, mobile or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <span className="muted small">
          {members.data ? `${shown.length} / ${members.data.length} members` : ''}
        </span>
      </div>

      {members.isError && (
        <p role="alert" className="error">
          {errorMessage(members.error)}
        </p>
      )}
      <section className="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Mobile</th>
              <th>Role</th>
              <th>Department</th>
              <th>Premises</th>
              <th>Status</th>
              <th>Password</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.id}>
                <td>
                  <strong>{m.name}</strong>
                  {m.designation && <span className="cell-sub">{m.designation}</span>}
                </td>
                <td className="mono">{m.phone}</td>
                <td>
                  <span className={`badge ${m.role === 'admin' ? 'badge-good' : 'badge-neutral'}`}>{ROLE_LABEL[m.role] ?? m.role}</span>
                </td>
                <td>{departmentName(m.departmentId)}</td>
                <td>{(m.premisesIds ?? []).map(premisesName).join(', ') || '-'}</td>
                <td>
                  <ActiveToggle member={m} />
                </td>
                <td>
                  <PasswordReset member={m} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {members.data && shown.length === 0 && (
          <EmptyState title={q ? 'No member matches that name or number.' : 'No members yet.'} />
        )}
      </section>
    </>
  );
}
