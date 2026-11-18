import { FormEvent, useState } from 'react';
import { errorMessage, useApi } from '../api';
import { PageHeader } from '../ui/Page';

const MIN = 8;

/** Set or change your own password. Users who signed in with OTP set the first one without a current password. */
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
    if (next.length < MIN) return setError(`Password must be at least ${MIN} characters.`);
    if (next !== again) return setError('The new passwords do not match.');
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
      <PageHeader title="Password" subtitle="Set a password to sign in with it. Changing it signs you out on your other devices." />
      <form className="form-card" onSubmit={save}>
        <div className="form-grid">
          <div>
            <label htmlFor="pw-current">Current password</label>
            <input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
            <span className="muted">Leave blank if you are setting it for the first time.</span>
          </div>
          <div>
            <label htmlFor="pw-new">New password</label>
            <input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="pw-again">Confirm new password</label>
            <input id="pw-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
          </div>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {done && <p role="status">Password saved.</p>}
        <button type="submit" className="primary" disabled={busy}>
          Save password
        </button>
      </form>
    </>
  );
}
