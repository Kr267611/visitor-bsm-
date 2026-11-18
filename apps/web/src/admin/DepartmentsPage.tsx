import type { Department } from '@visitor/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { errorMessage, useApi } from '../api';

const KEY = ['admin', 'departments'];

function DepartmentRow({ dept, onError }: { dept: Department; onError(message: string | null): void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(dept.name);
  const [confirming, setConfirming] = useState(false);

  async function run(work: () => Promise<unknown>) {
    onError(null);
    try {
      await work();
      setEditing(false);
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: KEY });
    } catch (e) {
      onError(errorMessage(e));
    }
  }

  return (
    <tr>
      <td>
        {editing ? (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api.admin.departments.update(dept.id, { name: name.trim() }));
            }}
          >
            <input aria-label={`${dept.name} ka naya naam`} value={name} onChange={(e) => setName(e.target.value)} required />
            <button type="submit">Save</button>
            <button type="button" onClick={() => setEditing(false)}>
              Rehne dein
            </button>
          </form>
        ) : (
          dept.name
        )}
      </td>
      <td>{dept.memberCount ?? 0}</td>
      <td>
        {!editing && (
          <div className="row">
            <button type="button" onClick={() => setEditing(true)}>
              Naam badlein
            </button>
            {!confirming ? (
              <button type="button" onClick={() => setConfirming(true)}>
                Hatayein
              </button>
            ) : (
              <>
                <button type="button" className="danger" onClick={() => void run(() => api.admin.departments.remove(dept.id))}>
                  Haan, hatayein
                </button>
                <button type="button" onClick={() => setConfirming(false)}>
                  Nahi
                </button>
              </>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

export function DepartmentsPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const departments = useQuery({ queryKey: KEY, queryFn: () => api.admin.departments.list() });
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function add(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.admin.departments.create({ name: name.trim() });
      setName('');
      await queryClient.invalidateQueries({ queryKey: KEY });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <>
      <h1>Departments</h1>
      <form className="form-card" onSubmit={add}>
        <div className="stack">
          <label htmlFor="dept-name">Department ka naam</label>
          <input id="dept-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <button type="submit" className="primary">
          Department jodein
        </button>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p className="muted">Department hatane par uske members bina department ke reh jaate hain; unka account nahi hatta.</p>
      <section className="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>Department</th>
              <th>Members</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {departments.data?.map((dept) => <DepartmentRow key={dept.id} dept={dept} onError={setError} />)}
            {departments.data?.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  Abhi koi department nahi.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
