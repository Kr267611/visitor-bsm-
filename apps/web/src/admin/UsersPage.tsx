import {
  ApiError,
  MODULE_LABEL,
  PASSWORD_MIN,
  ROLE_MODULES,
  type AdminUser,
  type Department,
  type MemberInput,
  type Module,
  type Role,
  type UserImportProblem,
  type UserImportRow,
} from '@visitor/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { errorMessage, useApi } from '../api';
import { useAuth } from '../auth/AuthProvider';
import { EmptyState, PageHeader, ROLE_LABEL } from '../ui/Page';
import { rowsFromCsv, TEMPLATE_CSV } from './csv';

const ROLES: { value: Exclude<Role, 'super_admin'>; label: string }[] = [
  { value: 'employee', label: 'Employee' },
  { value: 'guard', label: 'Guard' },
  { value: 'reception', label: 'Reception' },
  { value: 'security', label: 'Security' },
  { value: 'admin', label: 'Admin' },
];
const KEY = ['admin', 'users'];
const DAY = 24 * 60 * 60 * 1000;

const formatLastLogin = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'never';

/** Ticks shown for a user: no ticks saved means everything the role allows. */
const ticksFor = (role: Role, saved: readonly Module[]) => {
  const allowed = ROLE_MODULES[role] ?? [];
  return saved.length ? allowed.filter((m) => saved.includes(m)) : [...allowed];
};

/** What we save: everything ticked is stored as "no narrowing" (empty list). */
const modulesToSave = (role: Role, ticks: Module[]) => {
  const allowed = ROLE_MODULES[role] ?? [];
  return allowed.every((m) => ticks.includes(m)) ? [] : allowed.filter((m) => ticks.includes(m));
};

interface FormState {
  name: string;
  phone: string;
  email: string;
  role: Role;
  departmentId: string;
  designation: string;
  password: string;
  isHost: boolean;
  premisesIds: string[];
  modules: Module[];
}

const blank = (): FormState => ({
  name: '',
  phone: '',
  email: '',
  role: 'employee',
  departmentId: '',
  designation: '',
  password: '',
  isHost: true,
  premisesIds: [],
  modules: [...ROLE_MODULES.employee],
});

const fromUser = (u: AdminUser): FormState => ({
  name: u.name,
  phone: u.phone,
  email: u.email ?? '',
  role: u.role,
  departmentId: u.departmentId ?? '',
  designation: u.designation ?? '',
  password: '',
  isHost: u.isHost,
  premisesIds: u.premisesIds ?? [],
  modules: ticksFor(u.role, u.modules ?? []),
});

/** New user and edit user share this form. Editing yourself locks what could lock you out. */
function UserForm({
  editing,
  departments,
  premises,
  onDone,
}: {
  editing: AdminUser | null;
  departments: Department[];
  premises: { id: string; name: string }[];
  onDone(message: string | null): void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { user: me } = useAuth();
  const isSelf = !!editing && editing.id === me?.id;
  const [form, setForm] = useState<FormState>(() => (editing ? fromUser(editing) : blank()));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [passwordNote, setPasswordNote] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  // With a single premises there is nothing to choose: tick it.
  const onlyPremisesId = premises.length === 1 ? premises[0].id : null;
  useEffect(() => {
    if (onlyPremisesId && !form.premisesIds.length) set({ premisesIds: [onlyPremisesId] });
  }, [onlyPremisesId, form.premisesIds.length]);

  const designations = departments.find((d) => d.id === form.departmentId)?.designations ?? [];
  const designationHint = !form.departmentId
    ? 'Choose a department first'
    : designations.length
      ? 'None'
      : 'No designations in this department';
  const roleModules = ROLE_MODULES[form.role] ?? [];
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!form.premisesIds.length) return setError('Select at least one premises.');
    if (!form.modules.length) return setError('Tick at least one module, or deactivate the user instead.');
    const common = {
      name: form.name.trim(),
      role: form.role,
      premisesIds: form.premisesIds,
      isHost: form.isHost,
      departmentId: form.departmentId || null,
      designation: form.designation || null,
      modules: modulesToSave(form.role, form.modules),
    };
    setBusy(true);
    try {
      if (editing) {
        await api.admin.users.update(editing.id, { ...common, email: form.email.trim() || null });
      } else {
        const body: MemberInput = {
          ...common,
          phone: form.phone,
          password: form.password,
          ...(form.email.trim() && { email: form.email.trim() }),
        };
        await api.admin.users.create(body);
      }
      await queryClient.invalidateQueries({ queryKey: KEY });
      onDone(editing ? `${common.name} saved.` : `${common.name} added.`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!editing) return;
    setPasswordNote(null);
    if (newPassword.length < PASSWORD_MIN) {
      return setPasswordNote({ ok: false, text: `Password must be at least ${PASSWORD_MIN} characters.` });
    }
    try {
      await api.admin.users.resetPassword(editing.id, newPassword);
      setNewPassword('');
      setPasswordNote({ ok: true, text: 'New password set. The user has been signed out of other devices.' });
    } catch (e) {
      setPasswordNote({ ok: false, text: errorMessage(e) });
    }
  }

  return (
    <form className="form-card" onSubmit={save} aria-label={editing ? `Edit ${editing.name}` : 'New user'}>
      <h2>{editing ? `Edit ${editing.name}` : 'New user'}</h2>
      <div className="form-grid">
        <div>
          <label htmlFor="u-name">Name</label>
          <input id="u-name" value={form.name} onChange={(e) => set({ name: e.target.value })} required />
        </div>
        <div>
          <label htmlFor="u-phone">Mobile</label>
          <input
            id="u-phone"
            inputMode="tel"
            value={form.phone}
            onChange={(e) => set({ phone: e.target.value })}
            readOnly={!!editing}
            required
          />
        </div>
        <div>
          <label htmlFor="u-email">Email</label>
          <input id="u-email" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
        </div>
        <div>
          <label htmlFor="u-role">Role</label>
          <select
            id="u-role"
            value={form.role}
            disabled={isSelf}
            onChange={(e) => {
              const role = e.target.value as Role;
              set({ role, modules: [...(ROLE_MODULES[role] ?? [])] });
            }}
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="u-dept">Department</label>
          <select id="u-dept" value={form.departmentId} onChange={(e) => set({ departmentId: e.target.value, designation: '' })}>
            <option value="">None</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="u-designation">Designation</label>
          <select
            id="u-designation"
            value={form.designation}
            onChange={(e) => set({ designation: e.target.value })}
            disabled={!designations.length}
          >
            <option value="">{designationHint}</option>
            {designations.map((d) => (
              <option key={d.id} value={d.name}>
                {d.name}
              </option>
            ))}
            {/* A title typed before the designation list existed stays selectable. */}
            {form.designation && !designations.some((d) => d.name === form.designation) && (
              <option value={form.designation}>{form.designation}</option>
            )}
          </select>
        </div>
        {!editing && (
          <div>
            <label htmlFor="u-password">Password (at least {PASSWORD_MIN} characters)</label>
            <input
              id="u-password"
              type="password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN}
              value={form.password}
              onChange={(e) => set({ password: e.target.value })}
              required
            />
          </div>
        )}
      </div>

      <fieldset className="stack">
        <legend>Premises</legend>
        <div className="row">
          {premises.map((p) => (
            <label key={p.id} className="row">
              <input
                type="checkbox"
                checked={form.premisesIds.includes(p.id)}
                onChange={() => set({ premisesIds: toggle(form.premisesIds, p.id) })}
              />
              {p.name}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="stack">
        <legend>Module access</legend>
        <p className="muted small">
          Only ticked modules appear in this user&apos;s menu, and the server refuses the rest. The role sets what can be
          ticked.
        </p>
        <div className="module-grid">
          {roleModules.map((m) => {
            const locked = isSelf && m === 'users';
            return (
              <label key={m} className="row">
                <input
                  type="checkbox"
                  checked={form.modules.includes(m)}
                  disabled={locked}
                  onChange={() => set({ modules: toggle(form.modules, m) })}
                />
                {MODULE_LABEL[m]}
                {locked && <span className="muted small">(you cannot remove your own)</span>}
              </label>
            );
          })}
        </div>
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
          {editing ? 'Save changes' : 'Create user'}
        </button>
        <button type="button" onClick={() => onDone(null)}>
          Cancel
        </button>
      </div>

      {editing && (
        <div className="stack password-reset">
          <label htmlFor="u-new-password">Set a new password</label>
          <div className="row">
            <input
              id="u-new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <button type="button" onClick={() => void resetPassword()}>
              Set password
            </button>
          </div>
          {passwordNote && (
            <span role={passwordNote.ok ? 'status' : 'alert'} className={passwordNote.ok ? 'muted' : 'error'}>
              {passwordNote.text}
            </span>
          )}
        </div>
      )}
    </form>
  );
}

/** File text; FileReader for browsers (and test DOMs) without File.text(). */
function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/** Upload many users from a CSV saved from Excel. All or nothing; every problem is listed by line. */
function BulkUpload({ onDone }: { onDone(message: string | null): void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<UserImportRow[] | null>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [problems, setProblems] = useState<UserImportProblem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const templateHref = useMemo(() => `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE_CSV)}`, []);

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    setRows(null);
    setProblems([]);
    setError(null);
    setFileNote(null);
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      return setError('Please choose a .csv file. In Excel: File → Save As → CSV (Comma delimited).');
    }
    const parsed = rowsFromCsv(await readText(file));
    if (parsed.missing.length) return setError(`The file has no ${parsed.missing.join(', ')} column.`);
    if (!parsed.rows.length) return setError('The file has headings but no users.');
    setRows(parsed.rows);
    if (parsed.unknownColumns.length) setFileNote(`These columns are ignored: ${parsed.unknownColumns.join(', ')}.`);
  }

  async function upload() {
    if (!rows) return;
    setBusy(true);
    setError(null);
    setProblems([]);
    try {
      const result = await api.admin.users.importRows(rows);
      await queryClient.invalidateQueries({ queryKey: KEY });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'departments'] });
      const extra = [
        result.departmentsCreated && `${result.departmentsCreated} new department(s)`,
        result.designationsCreated && `${result.designationsCreated} new designation(s)`,
      ].filter(Boolean);
      onDone(`${result.created} user(s) added${extra.length ? `, with ${extra.join(' and ')}` : ''}.`);
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && Array.isArray(e.body.rows)) setProblems(e.body.rows as UserImportProblem[]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="form-card" aria-label="Bulk upload">
      <h2>Bulk upload</h2>
      <ol className="muted small upload-steps">
        <li>
          Download the <a href={templateHref} download="users-template.csv" className="link">template</a> and fill one
          user per line. Name, Mobile and Password are required.
        </li>
        <li>Role: Employee, Guard, Reception, Security or Admin (blank = Employee). Host: Yes or No (blank = Yes).</li>
        <li>New departments and designations are created for you. Blank premises = the default premises.</li>
        <li>In Excel, save as CSV (File → Save As → CSV), then choose the file below.</li>
      </ol>
      <div className="stack">
        <label htmlFor="u-file">CSV file</label>
        <input id="u-file" type="file" accept=".csv,text/csv" onChange={(e) => void pick(e)} />
      </div>
      {fileNote && <p className="muted small">{fileNote}</p>}
      {rows && (
        <p role="status">
          {rows.length} user(s) ready to upload. Nothing is saved if any line has a problem.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {problems.length > 0 && (
        <ul className="problem-list" aria-label="Lines to fix">
          {problems.map((p) => (
            <li key={p.line}>
              <strong>Line {p.line}:</strong> {p.errors.join(' ')}
            </li>
          ))}
        </ul>
      )}
      <div className="form-actions">
        <button type="button" className="primary" disabled={!rows || busy} onClick={() => void upload()}>
          {rows ? `Upload ${rows.length} user(s)` : 'Upload'}
        </button>
        <button type="button" onClick={() => onDone(null)}>
          Close
        </button>
      </div>
    </section>
  );
}

function ActiveToggle({ user, isSelf }: { user: AdminUser; isSelf: boolean }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setActive(isActive: boolean) {
    setError(null);
    try {
      await api.admin.users.update(user.id, { isActive });
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: KEY });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!user.isActive) {
    return (
      <div className="row">
        <span className="badge badge-neutral">Inactive</span>
        <button type="button" onClick={() => void setActive(true)}>
          Activate
        </button>
        {error && (
          <span role="alert" className="error">
            {error}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="row">
      <span className="badge badge-good">Active</span>
      {isSelf ? null : !confirming ? (
        <button type="button" onClick={() => setConfirming(true)} aria-label={`Deactivate ${user.name}`}>
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

type SortKey = 'name' | 'phone' | 'role' | 'department' | 'designation' | 'lastLogin';
const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'phone', label: 'Mobile' },
  { key: 'role', label: 'Role' },
  { key: 'department', label: 'Department' },
  { key: 'designation', label: 'Designation' },
  { key: 'lastLogin', label: 'Last login' },
];

export function UsersPage() {
  const api = useApi();
  const { user: me } = useAuth();
  const users = useQuery({ queryKey: KEY, queryFn: () => api.admin.users.list() });
  const premises = useQuery({ queryKey: ['admin', 'premises'], queryFn: () => api.admin.premises.list() });
  const departments = useQuery({ queryKey: ['admin', 'departments'], queryFn: () => api.admin.departments.list() });
  const [panel, setPanel] = useState<'new' | 'upload' | AdminUser | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filters, setFilters] = useState({ q: '', department: '', role: '', premises: '', status: 'active', login: '' });
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'name', asc: true });
  const setFilter = (patch: Partial<typeof filters>) => setFilters((f) => ({ ...f, ...patch }));

  const deptName = (id: string | null) => departments.data?.find((d) => d.id === id)?.name ?? '';
  const all = users.data ?? [];
  const activeCount = all.filter((u) => u.isActive).length;

  const shown = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const now = Date.now();
    const list = all.filter((u) => {
      if (q && ![u.name, u.phone, u.email ?? '', u.designation ?? ''].some((v) => v.toLowerCase().includes(q))) return false;
      if (filters.department === 'none' ? u.departmentId : filters.department && u.departmentId !== filters.department) return false;
      if (filters.role && u.role !== filters.role) return false;
      if (filters.premises && !(u.premisesIds ?? []).includes(filters.premises)) return false;
      if (filters.status === 'active' && !u.isActive) return false;
      if (filters.status === 'inactive' && u.isActive) return false;
      const last = u.lastLoginAt ? new Date(u.lastLoginAt).getTime() : null;
      if (filters.login === 'never' && last !== null) return false;
      if (filters.login === '7' && (last === null || now - last > 7 * DAY)) return false;
      if (filters.login === '30' && (last === null || now - last > 30 * DAY)) return false;
      if (filters.login === 'stale' && last !== null && now - last <= 30 * DAY) return false;
      return true;
    });
    const value = (u: AdminUser): string | number => {
      switch (sort.key) {
        case 'name':
          return u.name.toLowerCase();
        case 'phone':
          return u.phone;
        case 'role':
          return ROLE_LABEL[u.role] ?? u.role;
        case 'department':
          return deptName(u.departmentId).toLowerCase() || '￿';
        case 'designation':
          return (u.designation ?? '').toLowerCase() || '￿';
        case 'lastLogin':
          return u.lastLoginAt ? new Date(u.lastLoginAt).getTime() : 0;
      }
    };
    return [...list].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      const order = x < y ? -1 : x > y ? 1 : 0;
      return sort.asc ? order : -order;
    });
  }, [all, filters, sort, departments.data]);

  const close = (message: string | null) => {
    setPanel(null);
    setNotice(message);
  };
  const editing = panel && typeof panel === 'object' ? panel : null;

  return (
    <>
      <PageHeader
        title="Users"
        subtitle={users.data ? `${activeCount} active of ${all.length}` : 'Everyone who signs in: guards, reception, employees and admins.'}
        actions={
          <div className="row">
            <button type="button" onClick={() => setPanel(panel === 'upload' ? null : 'upload')}>
              Bulk upload
            </button>
            <button type="button" className="primary" onClick={() => setPanel(panel === 'new' ? null : 'new')}>
              + New user
            </button>
          </div>
        }
      />
      {notice && (
        <p role="status" className="notice notice-good">
          {notice}
        </p>
      )}
      {panel === 'upload' && <BulkUpload onDone={close} />}
      {(panel === 'new' || editing) && (
        <UserForm
          key={editing?.id ?? 'new'}
          editing={editing}
          departments={departments.data ?? []}
          premises={premises.data ?? []}
          onDone={close}
        />
      )}

      <section className="panel filter-panel" aria-label="Filter users">
        <div className="filters">
          <input
            type="search"
            aria-label="Search users"
            placeholder="Search name, mobile, email, designation…"
            value={filters.q}
            onChange={(e) => setFilter({ q: e.target.value })}
          />
          <select aria-label="Department filter" value={filters.department} onChange={(e) => setFilter({ department: e.target.value })}>
            <option value="">All departments</option>
            <option value="none">No department</option>
            {departments.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select aria-label="Role filter" value={filters.role} onChange={(e) => setFilter({ role: e.target.value })}>
            <option value="">All roles</option>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          {(premises.data?.length ?? 0) > 1 && (
            <select aria-label="Premises filter" value={filters.premises} onChange={(e) => setFilter({ premises: e.target.value })}>
              <option value="">All premises</option>
              {premises.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <select aria-label="Status filter" value={filters.status} onChange={(e) => setFilter({ status: e.target.value })}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="">All</option>
          </select>
          <select aria-label="Last login filter" value={filters.login} onChange={(e) => setFilter({ login: e.target.value })}>
            <option value="">Any last login</option>
            <option value="7">In the last 7 days</option>
            <option value="30">In the last 30 days</option>
            <option value="stale">Not in 30 days</option>
            <option value="never">Never</option>
          </select>
        </div>
      </section>

      {users.isError && (
        <p role="alert" className="error">
          {errorMessage(users.error)}
        </p>
      )}
      <section className="panel table-scroll" aria-label="Users list">
        <div className="panel-head">
          <h2>List users</h2>
          <span className="muted small">{users.data ? `${shown.length} user(s)` : ''}</span>
        </div>
        <table>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} aria-sort={sort.key === c.key ? (sort.asc ? 'ascending' : 'descending') : 'none'}>
                  <button
                    type="button"
                    className="sort-button"
                    onClick={() => setSort({ key: c.key, asc: sort.key === c.key ? !sort.asc : true })}
                  >
                    {c.label} <span aria-hidden="true">{sort.key === c.key ? (sort.asc ? '↑' : '↓') : '↕'}</span>
                  </button>
                </th>
              ))}
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id}>
                <td>
                  <strong>{u.name}</strong>
                  {u.email && <span className="cell-sub">{u.email}</span>}
                </td>
                <td className="mono">{u.phone}</td>
                <td>
                  <span className={`badge ${u.role === 'admin' ? 'badge-good' : 'badge-neutral'}`}>{ROLE_LABEL[u.role] ?? u.role}</span>
                </td>
                <td>{deptName(u.departmentId) || '—'}</td>
                <td>{u.designation || '—'}</td>
                <td className={u.lastLoginAt ? 'nowrap' : 'muted nowrap'}>{formatLastLogin(u.lastLoginAt)}</td>
                <td>
                  <div className="row row-actions">
                    <button type="button" aria-label={`Edit ${u.name}`} onClick={() => setPanel(u)}>
                      Edit
                    </button>
                    <ActiveToggle user={u} isSelf={u.id === me?.id} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.data && shown.length === 0 && (
          <EmptyState title={all.length ? 'No user matches these filters.' : 'No users yet.'} />
        )}
      </section>
    </>
  );
}
