import { normalizeIndianPhone } from '@visitor/shared';
import { FormEvent, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { errorMessage, useApi } from '../api';
import { useAuth } from './AuthProvider';
import { homeFor } from './RequireRole';

/** Sirf apni site ke andar ka raasta, bahar ka link nahi. */
function safeNext(next: string | null): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

export function LoginPage() {
  const api = useApi();
  const { user, signedIn } = useAuth();
  const [params] = useSearchParams();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={safeNext(params.get('next')) ?? homeFor(user.role)} replace />;

  async function requestOtp(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const normalized = normalizeIndianPhone(phone);
    if (!normalized) {
      setError('Mobile number sahi nahi hai. 10 digit ka number daalein.');
      return;
    }
    setBusy(true);
    try {
      await api.auth.requestOtp(normalized);
      setSentTo(phone);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      signedIn(await api.auth.verifyOtp({ phone, otp, deviceName: 'Web browser' }));
    } catch (e) {
      setError(errorMessage(e));
      setOtp('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="eyebrow">Visitor BSM</div>
        <h1>Login</h1>
        {sentTo === null ? (
          <form onSubmit={requestOtp} className="stack">
            <label htmlFor="phone">Mobile number</label>
            <input
              id="phone"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
            <button type="submit" className="primary" disabled={busy}>
              OTP bhejein
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="stack">
            <p className="muted">{sentTo} par OTP bheja gaya hai.</p>
            <label htmlFor="otp">OTP</label>
            <input
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              required
            />
            <button type="submit" className="primary" disabled={busy || otp.length !== 6}>
              Login karein
            </button>
            <button type="button" className="link" onClick={() => setSentTo(null)}>
              Number badlein
            </button>
          </form>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
