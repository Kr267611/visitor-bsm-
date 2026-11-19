import type { Department, Designation } from '@visitor/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { errorMessage, useApi } from '../api';
import { EmptyState, PageHeader } from '../ui/Page';

const KEY = ['admin', 'departments'];

/** One designation chip: click to rename or remove it. */
function DesignationChip({
  item,
  deptName,
  run,
}: {
  item: Designation;
  deptName: string;
  run(work: () => Promise<unknown>): Promise<boolean>;
}) {
  const api = useApi();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);

  if (!editing) {
    return (
      <button
        type="button"
        className="chip"
        aria-label={`Edit designation ${item.name} in ${deptName}`}
        onClick={() => setEditing(true)}
      >
        {item.name}
      </button>
    );
  }
  return (
    <form
      className="row chip-edit"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => api.admin.designations.rename(item.id, name.trim()))) setEditing(false);
      }}
    >
      <input aria-label={`New name for designation ${item.name}`} value={name} onChange={(e) => setName(e.target.value)} required />
      <button type="submit">Save</button>
      <button type="button" className="danger" onClick={() => void run(() => api.admin.designations.remove(item.id))}>
        Remove
      </button>
      <button type="button" onClick={() => setEditing(false)}>
        Cancel
      </button>
    </form>
  );
}

/** Designations of one department, with a small form to add another. */
function Designations({ dept, onError }: { dept: Department; onError(message: string | null): void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  async function run(work: () => Promise<unknown>) {
    onError(null);
    try {
      await work();
      await queryClient.invalidateQueries({ queryKey: KEY });
      return true;
    } catch (e) {
      onError(errorMessage(e));
      return false;
    }
  }

  return (
    <div className="stack designations">
      <div className="row">
        {dept.designations?.map((d) => <DesignationChip key={d.id} item={d} deptName={dept.name} run={run} />)}
        {!dept.designations?.length && <span className="muted small">No designations yet</span>}
      </div>
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => api.admin.departments.addDesignation(dept.id, name.trim()))) setName('');
        }}
      >
        <input
          aria-label={`New designation in ${dept.name}`}
          placeholder="e.g. Executive"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button type="submit">Add</button>
      </form>
    </div>
  );
}

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
            <input aria-label={`New name for ${dept.name}`} value={name} onChange={(e) => setName(e.target.value)} required />
            <button type="submit">Save</button>
            <button type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </form>
        ) : (
          dept.name
        )}
      </td>
      <td>
        <Designations dept={dept} onError={onError} />
      </td>
      <td>{dept.memberCount ?? 0}</td>
      <td>
        {!editing && (
          <div className="row">
            <button type="button" onClick={() => setEditing(true)}>
              Rename
            </button>
            {!confirming ? (
              <button type="button" onClick={() => setConfirming(true)}>
                Delete
              </button>
            ) : (
              <>
                <button type="button" className="danger" onClick={() => void run(() => api.admin.departments.remove(dept.id))}>
                  Yes, delete
                </button>
                <button type="button" onClick={() => setConfirming(false)}>
                  No
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
      <PageHeader
        title="Departments"
        subtitle="Group members by department, with the designations (job titles) used in each. Click a designation to rename or remove it."
      />
      <form className="form-card" onSubmit={add}>
        <div className="stack">
          <label htmlFor="dept-name">Department name</label>
          <input id="dept-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <button type="submit" className="primary">
          Add department
        </button>
        <p className="muted small">Deleting a department keeps its members; they are simply left without a department.</p>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <section className="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>Department</th>
              <th>Designations</th>
              <th>Members</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {departments.data?.map((dept) => <DepartmentRow key={dept.id} dept={dept} onError={setError} />)}
          </tbody>
        </table>
        {departments.data?.length === 0 && (
          <EmptyState title="No departments yet." hint="Add your first department above, for example Finance or HR." />
        )}
      </section>
    </>
  );
}
