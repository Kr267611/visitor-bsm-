import { normalizeIndianPhone } from '@visitor/shared';
import { useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { errorMessage, useApi } from '../api';

const todayIst = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const toIso = (date: string, time: string) => `${date}T${time}:00+05:30`;

export function InviteForm() {
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [date, setDate] = useState(todayIst);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [purpose, setPurpose] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!normalizeIndianPhone(phone)) {
      setError('Mobile number sahi nahi hai. 10 digit ka number daalein.');
      return;
    }
    if (end <= start) {
      setError('Kab tak ka time "Kab se" ke baad ka hona chahiye.');
      return;
    }
    setBusy(true);
    try {
      await api.visits.create({
        visitorName: name.trim(),
        visitorPhone: phone,
        validFrom: toIso(date, start),
        validTo: toIso(date, end),
        purpose: purpose.trim(),
      });
      await queryClient.invalidateQueries({ queryKey: ['visits'] });
      navigate('/my');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="spread">
        <h1>Naya invite</h1>
        <Link to="/my">Wapas</Link>
      </div>
      <form className="form-card" onSubmit={submit}>
        <div className="form-grid">
          <div>
            <label htmlFor="invite-name">Visitor ka naam</label>
            <input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="invite-phone">Visitor ka mobile</label>
            <input id="invite-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="invite-date">Date</label>
            <input id="invite-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="invite-start">Kab se</label>
            <input id="invite-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="invite-end">Kab tak</label>
            <input id="invite-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="invite-purpose">Kaam</label>
            <input id="invite-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} required />
          </div>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy}>
          Invite bhejein
        </button>
      </form>
    </>
  );
}
