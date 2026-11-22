import { ApiError, GeoPosition, normalizeIndianPhone, SelfCheckInSession } from '@visitor/shared';
import { useQuery } from '@tanstack/react-query';
import { ChangeEvent, FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { errorMessage, useApi } from '../api';
import { compressPhoto, PhotoError } from './compressPhoto';

type Step = 'form' | 'otp' | 'checked-in' | 'done';

/** Browser location for premises with a geofence. Rejects with a visitor-friendly message. */
function currentPosition(): Promise<GeoPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser cannot share your location. Please ask reception for help.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => reject(new Error('Please allow location access so we can confirm you are at the premises.')),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  });
}

function Shell({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <main className="visitor-page">
      <div className="visitor-card">
        <div className="form-card">
          <div className="stack" style={{ gap: 4 }}>
            {subtitle && <div className="eyebrow">{subtitle}</div>}
            <h1>{title}</h1>
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}

/**
 * Visitor self check-in from the premises QR poster. The visitor fills the whole form first,
 * then an OTP proves the phone and the request goes to the reception desk. Once approved,
 * the visitor's status page becomes the gate pass.
 */
export function SelfCheckInPage() {
  const { business = '', premises = '' } = useParams();
  const api = useApi();
  const navigate = useNavigate();
  const desk = useMemo(() => api.selfCheckIn(business, premises), [api, business, premises]);
  const info = useQuery({ queryKey: ['self-checkin', business, premises], queryFn: desk.info, retry: false });

  const [step, setStep] = useState<Step>('form');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [purpose, setPurpose] = useState('');
  const [about, setAbout] = useState('');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [otp, setOtp] = useState('');
  const [session, setSession] = useState<SelfCheckInSession | null>(null);
  const [location, setLocation] = useState<GeoPosition | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const uploadedKey = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  async function run(work: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setError(e instanceof ApiError || !(e instanceof Error) ? errorMessage(e) : e.message);
    } finally {
      setBusy(false);
    }
  }

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setPhoto(null);
    setPreview(null);
    uploadedKey.current = null;
    try {
      const compressed = await compressPhoto(file);
      setPhoto(compressed);
      setPreview(URL.createObjectURL(compressed));
    } catch (e) {
      setError(e instanceof PhotoError ? e.message : 'This photo cannot be used. Please take a new one with the camera.');
    }
  }

  const formReady = !!name.trim() && !!phone.trim() && !!purpose && about.trim().length >= 3 && !!photo && consent;

  /** Sends the request to the desk with a verified session. */
  async function sendRequest(current: SelfCheckInSession, where: GeoPosition | undefined) {
    try {
      // On retry, do not upload the photo again.
      if (photo) uploadedKey.current ??= (await desk.uploadPhoto(current.sessionToken, photo)).key;
      const result = await desk.checkIn(current.sessionToken, {
        name: name.trim(),
        company: company.trim() || undefined,
        purpose,
        purposeNote: about.trim(),
        photoKey: uploadedKey.current ?? undefined,
        consent,
        location: where,
      });
      navigate(`/v/${result.token}`, { replace: true });
    } catch (e) {
      // An expired session needs a new OTP; anything else can be retried as is.
      if (e instanceof ApiError && e.status === 401) {
        setSession(null);
        setOtp('');
      }
      throw e;
    }
  }

  function submitForm(event: FormEvent) {
    event.preventDefault();
    if (!formReady || busy) return;
    const normalized = normalizeIndianPhone(phone);
    if (!normalized) {
      setError('Enter a valid 10-digit mobile number.');
      return;
    }
    void run(async () => {
      if (session) {
        // Number already verified (the visitor went back to fix a detail).
        await sendRequest(session, location);
        return;
      }
      await desk.requestOtp(normalized);
      setOtp('');
      setStep('otp');
    });
  }

  function verify(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      if (session) {
        await sendRequest(session, location);
        return;
      }
      const where = info.data?.needsLocation ? await currentPosition() : undefined;
      setLocation(where);
      let result: SelfCheckInSession;
      try {
        result = await desk.verify({ phone, otp, location: where });
      } catch (e) {
        setOtp('');
        throw e;
      }
      setSession(result);
      const active = result.activeVisit;
      if (active?.status === 'CHECKED_IN') {
        setStep('checked-in');
      } else if (active) {
        // An open visit already exists here: its page shows the pass or the status.
        navigate(`/v/${active.token}`, { replace: true });
      } else {
        await sendRequest(result, where);
      }
    });
  }

  function checkOut() {
    if (!session) return;
    void run(async () => {
      await desk.checkOut(session.sessionToken);
      setStep('done');
    });
  }

  const alert = error && (
    <p role="alert" className="error">
      {error}
    </p>
  );

  if (info.isPending) return <Shell title="Loading…" />;
  if (info.isError) {
    const missing = info.error instanceof ApiError && info.error.status === 404;
    return (
      <Shell title={missing ? 'This check-in link is not valid' : 'Something went wrong'}>
        {!missing && <p className="muted">{errorMessage(info.error)}</p>}
      </Shell>
    );
  }
  const place = info.data;
  const subtitle = `${place.businessName} · ${place.premisesName}`;

  if (place.status === 'unavailable') {
    return (
      <Shell title="Currently unavailable" subtitle={subtitle}>
        <p className="muted">Self check-in is not available right now. Please contact reception.</p>
      </Shell>
    );
  }
  if (place.status === 'closed') {
    return (
      <Shell title="Closed for visitors" subtitle={subtitle}>
        <p className="muted">
          Check-in is open from {place.visitStart ?? '00:00'} to {place.visitEnd ?? '24:00'}. Please contact reception.
        </p>
      </Shell>
    );
  }

  if (step === 'done') {
    return (
      <Shell title="You are checked out" subtitle={subtitle}>
        <p className="muted">Thank you for visiting.</p>
      </Shell>
    );
  }

  if (step === 'checked-in' && session?.activeVisit) {
    return (
      <Shell title="You are checked in" subtitle={subtitle}>
        <p className="muted">Leaving now? Check out here, or open your pass to show it at the gate.</p>
        <button type="button" className="primary" disabled={busy} onClick={checkOut}>
          Check out
        </button>
        <Link to={`/v/${session.activeVisit.token}`}>Show my pass</Link>
        {alert}
      </Shell>
    );
  }

  if (step === 'otp') {
    return (
      <Shell title="Enter the OTP" subtitle={subtitle}>
        <p className="muted">
          {session
            ? 'Your number is verified. Send your request again.'
            : `We sent a 6-digit code to ${phone}. Your request goes to the reception desk once you verify.`}
          {!session && place.needsLocation && ' We will also check that you are at the premises.'}
        </p>
        <form className="stack" onSubmit={verify}>
          {!session && (
            <>
              <label htmlFor="sc-otp">OTP</label>
              <input
                id="sc-otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                required
              />
            </>
          )}
          {alert}
          <button type="submit" className="primary" disabled={busy || (!session && otp.length !== 6)}>
            {busy ? 'Please wait…' : session ? 'Send request' : 'Verify and send request'}
          </button>
          <button
            type="button"
            className="link"
            onClick={() => {
              setError(null);
              setStep('form');
            }}
          >
            {session ? 'Edit my details' : 'Edit details or change number'}
          </button>
        </form>
      </Shell>
    );
  }

  return (
    <Shell title="Visitor check-in" subtitle={subtitle}>
      <p className="muted">Fill in your details. We will then send an OTP to your mobile. No app needed.</p>
      <form className="stack" onSubmit={submitForm}>
        <label htmlFor="sc-name">Your name</label>
        <input id="sc-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />

        <label htmlFor="sc-phone">Mobile number</label>
        <input
          id="sc-phone"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            // A new number has to be verified again.
            if (session) setSession(null);
          }}
          required
        />

        <label htmlFor="sc-company">Company or firm</label>
        <input
          id="sc-company"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          autoComplete="organization"
          placeholder="e.g. ABC Traders (leave blank if personal)"
        />

        <label htmlFor="sc-purpose">Purpose of visit</label>
        <select id="sc-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} required>
          <option value="">Choose the purpose</option>
          {place.purposes.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <label htmlFor="sc-about">About your visit</label>
        <textarea
          id="sc-about"
          rows={3}
          maxLength={300}
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          placeholder="Write the details and who you want to meet, e.g. Yarn delivery for order 452, to meet the weaving master"
          required
        />
        <p className="muted small">Your request goes to the reception desk, who will let you in.</p>

        <label htmlFor="sc-photo">Your photo</label>
        <input id="sc-photo" type="file" accept="image/*" capture="user" onChange={choosePhoto} />
        {preview && <img src={preview} alt="Selected photo" className="photo-preview" />}
        <p className="muted small">The guard uses this to recognise you at the gate.</p>

        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            I agree that my details and photo will be stored for the visitor record.{' '}
            <Link to="/privacy">Privacy notice</Link>
          </span>
        </label>

        {alert}
        <button type="submit" className="primary" disabled={!formReady || busy}>
          {busy ? 'Please wait…' : session ? 'Send request' : 'Send OTP'}
        </button>
      </form>
    </Shell>
  );
}
