import { BusinessChoice, businessChoice, normalizeIndianPhone, Session } from '@visitor/shared';
import { FormEvent, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { errorMessage, useApi } from '../api';
import { useAuth } from './AuthProvider';
import { homeFor } from './RequireRole';

const DEVICE = 'Web browser';

/** Sirf apni site ke andar ka raasta, bahar ka link nahi. */
function safeNext(next: string | null): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

type Mode = 'password' | 'otp';

export function LoginPage() {
  const api = useApi();
  const { user, signedIn } = useAuth();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<Mode>('password');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [choice, setChoice] = useState<BusinessChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={safeNext(params.get('next')) ?? homeFor(user.role)} replace />;

  /** Login ka koi bhi raasta: session mile to andar, kai businesses hon to list dikhao. */
  async function attempt(work: () => Promise<Session>, onFail?: () => void) {
    setError(null);
    setBusy(true);
    try {
      signedIn(await work());
    } catch (e) {
      const options = businessChoice(e);
      if (options) setChoice(options);
      else {
        setError(errorMessage(e));
        onFail?.();
      }
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  function passwordLogin(event: FormEvent) {
    event.preventDefault();
    void attempt(
      () => api.auth.login({ identifier: identifier.trim(), password, deviceName: DEVICE }),
      () => setPassword(''),
    );
  }

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

  function verify(event: FormEvent) {
    event.preventDefault();
    void attempt(
      () => api.auth.verifyOtp({ phone, otp, deviceName: DEVICE }),
      () => setOtp(''),
    );
  }

  function choose(businessId: string | null) {
    if (!choice) return;
    const token = choice.selectionToken;
    void attempt(
      () => api.auth.selectBusiness({ selectionToken: token, businessId, deviceName: DEVICE }),
      // Token ek hi baar chalta hai: galti par dobara login.
      () => setChoice(null),
    );
  }

  const alert = error && (
    <p role="alert" className="error">
      {error}
    </p>
  );

  if (choice) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <div className="eyebrow">Visitor BSM</div>
          <h1>Business chunein</h1>
          <p className="muted">Aapka account in businesses mein hai. Kismein login karna hai?</p>
          <div className="stack">
            {choice.businesses.map((b) => (
              <button key={b.id ?? 'platform'} type="button" disabled={busy} onClick={() => choose(b.id)}>
                {b.name}
              </button>
            ))}
          </div>
          <button type="button" className="link" onClick={() => setChoice(null)}>
            Wapas
          </button>
          {alert}
        </div>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="eyebrow">Visitor BSM</div>
        <h1>Login</h1>
        <div className="row" role="tablist" aria-label="Login ka tareeka">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'password'}
            className={mode === 'password' ? 'primary' : ''}
            onClick={() => switchMode('password')}
          >
            Password
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'otp'}
            className={mode === 'otp' ? 'primary' : ''}
            onClick={() => switchMode('otp')}
          >
            OTP
          </button>
        </div>

        {mode === 'password' ? (
          <form onSubmit={passwordLogin} className="stack">
            <label htmlFor="identifier">Mobile ya email</label>
            <input
              id="identifier"
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
            />
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button type="submit" className="primary" disabled={busy}>
              Login karein
            </button>
          </form>
        ) : sentTo === null ? (
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
        {alert}
      </div>
    </main>
  );
}
