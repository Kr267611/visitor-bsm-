import { BusinessChoice, businessChoice, normalizeIndianPhone, Session } from '@visitor/shared';
import { FormEvent, ReactNode, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { errorMessage, useApi } from '../api';
import { useAuth } from './AuthProvider';
import { homeFor } from './RequireRole';

const DEVICE = 'Web browser';

/** Only paths inside this app, never an external link. */
function safeNext(next: string | null): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

type Mode = 'password' | 'otp';

/** Product intro next to the sign-in form (compact on mobile). */
function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="auth-split">
      <section className="auth-brand" aria-label="Visitor BSM">
        <div className="stack">
          <span className="eyebrow">Visitor BSM</span>
          <h2>Every visitor accounted for, from the gate to reception.</h2>
        </div>
        <ul>
          <li>Pre-invited visitors get a QR pass and a single scan at the gate.</li>
          <li>Walk-in approvals go straight to the host's phone.</li>
          <li>See who is inside and who is expected, live.</li>
        </ul>
      </section>
      <div className="auth-side">
        <div className="auth-card">{children}</div>
      </div>
    </main>
  );
}

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

  /** Any sign-in path: a session signs the user in; several businesses show the picker. */
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
      setError('Enter a valid 10-digit mobile number.');
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
      // The selection token works only once: on failure, start the sign-in again.
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
      <AuthFrame>
        <h1>Choose a business</h1>
        <p className="muted">Your account belongs to these businesses. Which one do you want to sign in to?</p>
        <div className="stack">
          {choice.businesses.map((b) => (
            <button key={b.id ?? 'platform'} type="button" disabled={busy} onClick={() => choose(b.id)}>
              {b.name}
            </button>
          ))}
        </div>
        <button type="button" className="link" onClick={() => setChoice(null)}>
          Back
        </button>
        {alert}
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <div className="stack" style={{ gap: 4 }}>
        <h1>Sign in</h1>
        <p className="muted">Use your work account.</p>
      </div>
      <div className="tabs" role="tablist" aria-label="Sign-in method">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'password'}
          onClick={() => switchMode('password')}
        >
          Password
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'otp'}
          onClick={() => switchMode('otp')}
        >
          OTP
        </button>
      </div>

      {mode === 'password' ? (
        <form onSubmit={passwordLogin} className="stack">
          <label htmlFor="identifier">Mobile or email</label>
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
            Sign in
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
            Send OTP
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="stack">
          <p className="muted">OTP sent to {sentTo}.</p>
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
            Sign in
          </button>
          <button type="button" className="link" onClick={() => setSentTo(null)}>
            Change number
          </button>
        </form>
      )}
      {alert}
    </AuthFrame>
  );
}
