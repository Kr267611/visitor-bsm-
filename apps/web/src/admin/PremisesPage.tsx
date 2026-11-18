import type { Premises, PremisesSettings } from '@visitor/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { errorMessage, useApi } from '../api';

const toNumber = (v: string) => (v.trim() === '' ? null : Number(v));

/** Settings ke basic hisse; baaki (reports, review link) baad ke phase mein. */
function SettingsForm({ premises }: { premises: Premises }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const key = ['admin', 'premises', premises.id, 'settings'];
  const settings = useQuery({ queryKey: key, queryFn: () => api.admin.premises.settings(premises.id) });
  const [form, setForm] = useState({ visitStart: '', visitEnd: '', defaultVisitMin: '', overstayMin: '', checkinOnApproval: true });
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
    };
    try {
      queryClient.setQueryData(key, await api.admin.premises.updateSettings(premises.id, body));
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (settings.isError) return <p role="alert" className="error">{errorMessage(settings.error)}</p>;
  if (!settings.data) return <p className="muted">Settings aa rahi hain...</p>;
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  return (
    <form className="form-card" onSubmit={save} aria-label={`${premises.name} settings`}>
      <h2>{premises.name}: settings</h2>
      <div className="form-grid">
        <div>
          <label htmlFor="set-start">Visit shuru (HH:MM)</label>
          <input id="set-start" type="time" value={form.visitStart} onChange={(e) => set({ visitStart: e.target.value })} />
        </div>
        <div>
          <label htmlFor="set-end">Visit khatam (HH:MM)</label>
          <input id="set-end" type="time" value={form.visitEnd} onChange={(e) => set({ visitEnd: e.target.value })} />
        </div>
        <div>
          <label htmlFor="set-default">Visit ka default time (minute)</label>
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
          <label htmlFor="set-overstay">Overstay alert (minute)</label>
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
        Approval ke baad hi check-in
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {saved && <p role="status">Settings save ho gayin.</p>}
      <button type="submit" className="primary">
        Settings save karein
      </button>
    </form>
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
      // Side menu ka premises switcher bhi naya premises dikhaye.
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
      <h1>Premises aur gates</h1>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="desk-grid">
        <form className="form-card" onSubmit={addPremises}>
          <h2>Naya premises</h2>
          <div className="stack">
            <label htmlFor="premises-name">Premises ka naam</label>
            <input id="premises-name" value={name} onChange={(e) => setName(e.target.value)} required />
            <label htmlFor="premises-address">Pata</label>
            <input id="premises-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <button type="submit">Premises jodein</button>
        </form>
        <form className="form-card" onSubmit={addGate}>
          <h2>Naya gate</h2>
          <div className="stack">
            <label htmlFor="gate-premises">Gate ka premises</label>
            <select id="gate-premises" value={gatePremises} onChange={(e) => setGatePremises(e.target.value)} required>
              <option value="">Chunein</option>
              {premises.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
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
                  {p.name} {p.isDefault && <span className="badge badge-good">Default</span>}
                </td>
                <td className="mono">{p.code}</td>
                <td>
                  {gates.data
                    ?.filter((gate) => gate.premisesId === p.id)
                    .map((gate) => gate.name)
                    .join(', ') || '-'}
                </td>
                <td>
                  <button type="button" onClick={() => setSelected(selected === p.id ? null : p.id)}>
                    {selected === p.id ? 'Settings band' : 'Settings'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {chosen && <SettingsForm key={chosen.id} premises={chosen} />}
    </>
  );
}
