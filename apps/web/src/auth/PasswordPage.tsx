import { FormEvent, useState } from 'react';
import { errorMessage, useApi } from '../api';
import { PageHeader } from '../ui/Page';

const MIN = 8;

/** Apna password set/badlein. OTP se aaye user ka pehla password: purana nahi maangte. */
export function PasswordPage() {
  const api = useApi();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setDone(false);
    if (next.length < MIN) return setError(`Password kam se kam ${MIN} akshar ka ho.`);
    if (next !== again) return setError('Dono naye password ek jaise nahi hain.');
    setBusy(true);
    try {
      await api.me.changePassword({ currentPassword: current || undefined, newPassword: next });
      setCurrent('');
      setNext('');
      setAgain('');
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Password" subtitle="Password se login karne ke liye set karein. Badalne par aapke baaki devices logout ho jayenge." />
      <form className="form-card" onSubmit={save}>
        <div className="form-grid">
          <div>
            <label htmlFor="pw-current">Purana password</label>
            <input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
            <span className="muted">Pehli baar set kar rahe hain to khaali chhodein.</span>
          </div>
          <div>
            <label htmlFor="pw-new">Naya password</label>
            <input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="pw-again">Naya password dobara</label>
            <input id="pw-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
          </div>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {done && <p role="status">Password save ho gaya.</p>}
        <button type="submit" className="primary" disabled={busy}>
          Password save karein
        </button>
      </form>
    </>
  );
}
