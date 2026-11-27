import type { Premises, PremisesSettings } from '@visitor/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage, useApi } from '../api';
import { PageHeader } from '../ui/Page';

const toNumber = (v: string) => (v.trim() === '' ? null : Number(v));

/** Basic settings only; the rest (reports, review link) comes in a later phase. */
function SettingsForm({ premises }: { premises: Premises }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const key = ['admin', 'premises', premises.id, 'settings'];
  const settings = useQuery({ queryKey: key, queryFn: () => api.admin.premises.settings(premises.id) });
  const [form, setForm] = useState({ visitStart: '', visitEnd: '', defaultVisitMin: '', overstayMin: '', checkinOnApproval: true, verifyPhone: false });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    setForm({
      visitStart: s.visitStart ?? '',
      visitEnd: s.visitEnd ?? '',
      defaultVisitMin: String(s.defaultVisitMin),
      overstayMin: s.overstayMin == null ? '' : String(s.overstayMin),
      checkinOnApproval: s.checkinOnApproval,
      verifyPhone: s.verifyPhone ?? false,
    });
  }, [settings.data]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    const body: Partial<PremisesSettings> = {
      visitStart: form.visitStart || null,
      visitEnd: form.visitEnd || null,
      defaultVisitMin: Number(form.defaultVisitMin),
      overstayMin: toNumber(form.overstayMin),
      checkinOnApproval: form.checkinOnApproval,
      verifyPhone: form.verifyPhone,
    };
    try {
      queryClient.setQueryData(key, await api.admin.premises.updateSettings(premises.id, body));
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (settings.isError) return <p role="alert" className="error">{errorMessage(settings.error)}</p>;
  if (!settings.data) return <p className="muted">Loading settings…</p>;
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  return (
    <form className="form-card" onSubmit={save} aria-label={`${premises.name} settings`}>
      <h2>{premises.name}: settings</h2>
      <div className="form-grid">
        <div>
          <label htmlFor="set-start">Visiting hours start</label>
          <input id="set-start" type="time" value={form.visitStart} onChange={(e) => set({ visitStart: e.target.value })} />
        </div>
        <div>
          <label htmlFor="set-end">Visiting hours end</label>
          <input id="set-end" type="time" value={form.visitEnd} onChange={(e) => set({ visitEnd: e.target.value })} />
        </div>
        <div>
          <label htmlFor="set-default">Default visit length (minutes)</label>
          <input
            id="set-default"
            type="number"
            min={15}
            max={1440}
            value={form.defaultVisitMin}
            onChange={(e) => set({ defaultVisitMin: e.target.value })}
            required
          />
        </div>
        <div>
          <label htmlFor="set-overstay">Overstay alert (minutes)</label>
          <input
            id="set-overstay"
            type="number"
            min={1}
            max={1440}
            value={form.overstayMin}
            onChange={(e) => set({ overstayMin: e.target.value })}
          />
        </div>
      </div>
      <label className="row">
        <input
          type="checkbox"
          checked={form.checkinOnApproval}
          onChange={(e) => set({ checkinOnApproval: e.target.checked })}
        />
        Check-in only after approval
      </label>
      <label className="row">
        <input type="checkbox" checked={form.verifyPhone} onChange={(e) => set({ verifyPhone: e.target.checked })} />
        Verify the visitor's mobile with an SMS OTP on the QR form (needs SMS to be set up)
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {saved && <p role="status">Settings saved.</p>}
      <button type="submit" className="primary">
        Save settings
      </button>
    </form>
  );
}

/** Categories a visitor picks from on the QR check-in form. */
function PurposesEditor({ premises }: { premises: Premises }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [list, setList] = useState<string[]>(premises.purposes ?? []);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(next: string[]) {
    setError(null);
    setSaved(false);
    try {
      await api.admin.premises.update(premises.id, { purposes: next });
      setList(next);
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'premises'] });
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const value = draft.trim();
    if (!value) return;
    if (list.some((p) => p.toLowerCase() === value.toLowerCase())) {
      setError('That purpose is already in the list.');
      return;
    }
    if (await save([...list, value])) setDraft('');
  }

  return (
    <section className="form-card" aria-label={`${premises.name} purposes`}>
      <h2>Purpose of visit</h2>
      <p className="muted small">Visitors pick one of these on the QR check-in form, then write what the visit is about.</p>
      <ul className="purpose-list">
        {list.map((p) => (
          <li key={p} className="chip-row">
            <span>{p}</span>
            <button
              type="button"
              className="link"
              aria-label={`Remove ${p}`}
              disabled={list.length <= 1}
              onClick={() => void save(list.filter((x) => x !== p))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form className="row" onSubmit={(e) => void add(e)}>
        <input
          aria-label="New purpose"
          placeholder="e.g. Yarn supply"
          maxLength={60}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ flex: '1 1 200px', width: 'auto' }}
        />
        <button type="submit">Add purpose</button>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {saved && <p role="status">Purposes saved.</p>}
    </section>
  );
}

export function PremisesPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const premises = useQuery({ queryKey: ['admin', 'premises'], queryFn: () => api.admin.premises.list() });
  const gates = useQuery({ queryKey: ['admin', 'gates'], queryFn: () => api.admin.gates.list() });
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [gatePremises, setGatePremises] = useState('');
  const [gateName, setGateName] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(work: () => Promise<unknown>, reset: () => void) {
    setError(null);
    try {
      await work();
      reset();
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
      // The premises switcher in the side menu should show the new premises too.
      await queryClient.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function addPremises(event: FormEvent) {
    event.preventDefault();
    void run(
      () => api.admin.premises.create({ name: name.trim(), ...(address.trim() && { address: address.trim() }) }),
      () => {
        setName('');
        setAddress('');
      },
    );
  }

  function addGate(event: FormEvent) {
    event.preventDefault();
    void run(() => api.admin.gates.create({ premisesId: gatePremises, name: gateName.trim() }), () => setGateName(''));
  }

  const chosen = premises.data?.find((p) => p.id === selected);

  return (
    <>
      <PageHeader
        title="Premises & gates"
        subtitle="Each office, plant or site is a premises. A visitor kiosk identifies its premises by the kiosk code."
      />
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="desk-grid">
        <form className="form-card" onSubmit={addPremises}>
          <h2>New premises</h2>
          <div className="stack">
            <label htmlFor="premises-name">Premises name</label>
            <input id="premises-name" value={name} onChange={(e) => setName(e.target.value)} required />
            <label htmlFor="premises-address">Address</label>
            <input id="premises-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <button type="submit">Add premises</button>
        </form>
        <form className="form-card" onSubmit={addGate}>
          <h2>New gate</h2>
          <div className="stack">
            <label htmlFor="gate-premises">Gate premises</label>
            <select id="gate-premises" value={gatePremises} onChange={(e) => setGatePremises(e.target.value)} required>
              <option value="">Select</option>
              {premises.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <label htmlFor="gate-name">Gate name</label>
            <input id="gate-name" value={gateName} onChange={(e) => setGateName(e.target.value)} required />
          </div>
          <button type="submit">Add gate</button>
        </form>
      </div>
      <section className="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>Premises</th>
              <th>Kiosk code</th>
              <th>Gates</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {premises.data?.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.name} {p.isDefault && <span className="badge badge-brand">Default</span>}
                </td>
                <td className="mono">{p.code}</td>
                <td>
                  {gates.data
                    ?.filter((gate) => gate.premisesId === p.id)
                    .map((gate) => gate.name)
                    .join(', ') || '-'}
                </td>
                <td>
                  <div className="row">
                    <button type="button" onClick={() => setSelected(selected === p.id ? null : p.id)}>
                      {selected === p.id ? 'Hide settings' : 'Settings'}
                    </button>
                    <Link to={`/admin/premises/${p.id}/poster`}>QR poster</Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {chosen && <SettingsForm key={chosen.id} premises={chosen} />}
      {chosen && <PurposesEditor key={`purposes-${chosen.id}`} premises={chosen} />}
    </>
  );
}
