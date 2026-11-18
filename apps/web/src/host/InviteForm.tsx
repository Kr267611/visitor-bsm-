import { normalizeIndianPhone } from '@visitor/shared';
import { useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { errorMessage, useApi } from '../api';
import { PageHeader } from '../ui/Page';

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
      setError('Enter a valid 10-digit mobile number.');
      return;
    }
    if (end <= start) {
      setError('"Until" must be later than "From".');
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
      <PageHeader
        title="New invite"
        subtitle="The visitor gets an SMS link to add a photo and details, then receives a QR pass."
        actions={<Link to="/my">Back</Link>}
      />
      <form className="form-card" onSubmit={submit}>
        <div className="form-grid">
          <div>
            <label htmlFor="invite-name">Visitor name</label>
            <input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="invite-phone">Visitor mobile</label>
            <input id="invite-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="invite-date">Date</label>
            <input id="invite-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="invite-start">From</label>
            <input id="invite-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="invite-end">Until</label>
            <input id="invite-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="invite-purpose">Purpose</label>
            <input id="invite-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} required />
          </div>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy}>
          Send invite
        </button>
      </form>
    </>
  );
}
