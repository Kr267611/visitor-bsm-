import type { AdminUser, Department } from '@visitor/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { errorMessage, useApi } from '../api';
import { EmptyState, PageHeader, ROLE_LABEL } from '../ui/Page';
import { Designations } from './DepartmentsPage';

const USERS = ['admin', 'users'];

/** One person: department and designation, saved the moment either changes. */
function PersonRow({ user, departments }: { user: AdminUser; departments: Department[] }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const titles = departments.find((d) => d.id === user.departmentId)?.designations ?? [];

  async function save(patch: { departmentId?: string | null; designation: string | null }) {
    setError(null);
    setState('saving');
    try {
      await api.admin.users.update(user.id, patch);
      await queryClient.invalidateQueries({ queryKey: USERS });
      setState('saved');
    } catch (e) {
      setError(errorMessage(e));
      setState('idle');
    }
  }

  return (
    <tr>
      <td>
        <strong>{user.name}</strong>
        <span className="cell-sub">{ROLE_LABEL[user.role] ?? user.role}</span>
      </td>
      <td className="mono">{user.phone}</td>
      <td>
        <select
          aria-label={`Department of ${user.name}`}
          value={user.departmentId ?? ''}
          onChange={(e) => void save({ departmentId: e.target.value || null, designation: null })}
        >
          <option value="">No department</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </td>
      <td>
        <select
          aria-label={`Designation of ${user.name}`}
          value={user.designation ?? ''}
          disabled={!titles.length && !user.designation}
          onChange={(e) => void save({ designation: e.target.value || null })}
        >
          <option value="">{user.departmentId ? (titles.length ? 'None' : 'No designations yet') : 'Choose a department'}</option>
          {titles.map((t) => (
            <option key={t.id} value={t.name}>
              {t.name}
            </option>
          ))}
          {user.designation && !titles.some((t) => t.name === user.designation) && (
            <option value={user.designation}>{user.designation}</option>
          )}
        </select>
      </td>
      <td aria-live="polite" className="small">
        {error ? (
          <span role="alert" className="error">
            {error}
          </span>
        ) : state === 'saving' ? (
          <span className="muted">Saving…</span>
        ) : state === 'saved' ? (
          <span className="saved">Saved</span>
        ) : null}
      </td>
    </tr>
  );
}

/** Give everyone their designation: pick a department, manage its titles, set each person's title. */
export function DesignationsPage() {
  const api = useApi();
  const users = useQuery({ queryKey: USERS, queryFn: () => api.admin.users.list() });
  const departments = useQuery({ queryKey: ['admin', 'departments'], queryFn: () => api.admin.departments.list() });
  const [department, setDepartment] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);

  const chosen = departments.data?.find((d) => d.id === department) ?? null;
  const shown = useMemo(() => {
    const text = q.trim().toLowerCase();
    return (users.data ?? [])
      .filter((u) => u.isActive)
      .filter((u) => (department === 'none' ? !u.departmentId : !department || u.departmentId === department))
      .filter((u) => !text || u.name.toLowerCase().includes(text) || u.phone.includes(text))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users.data, department, q]);
  const withoutTitle = shown.filter((u) => !u.designation).length;

  return (
    <>
      <PageHeader
        title="Designations"
        subtitle="Set the designation of every person. Pick a department to add or rename its designations."
      />
      <section className="panel filter-panel" aria-label="Choose people">
        <div className="filters">
          <input type="search" aria-label="Search people" placeholder="Search name or mobile…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label="Department" value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">All departments</option>
            <option value="none">No department</option>
            {departments.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      {chosen && (
        <section className="form-card" aria-label={`Designations in ${chosen.name}`}>
          <h2>Designations in {chosen.name}</h2>
          <Designations dept={chosen} onError={setError} />
        </section>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      <section className="panel table-scroll" aria-label="People">
        <div className="panel-head">
          <h2>People</h2>
          <span className="muted small">
            {users.data ? `${shown.length} people, ${withoutTitle} without a designation` : ''}
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Mobile</th>
              <th>Department</th>
              <th>Designation</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <PersonRow key={u.id} user={u} departments={departments.data ?? []} />
            ))}
          </tbody>
        </table>
        {users.data && shown.length === 0 && <EmptyState title="Nobody here yet." hint="Add people on the Users page." />}
      </section>
    </>
  );
}
