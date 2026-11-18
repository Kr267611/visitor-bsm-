import { ApiError, GeoPosition, normalizeIndianPhone, SelfCheckInSession } from '@visitor/shared';
import { useQuery } from '@tanstack/react-query';
import { ChangeEvent, FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { errorMessage, useApi } from '../api';
import { compressPhoto, PhotoError } from './compressPhoto';

type Step = 'phone' | 'otp' | 'details' | 'checked-in' | 'done';

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
 * Visitor self check-in from the premises QR poster. The poster only starts the flow:
 * OTP proves the phone, the host approves, and the visitor's status page becomes the gate pass.
 */
export function SelfCheckInPage() {
  const { business = '', premises = '' } = useParams();
  const api = useApi();
  const navigate = useNavigate();
  const desk = useMemo(() => api.selfCheckIn(business, premises), [api, business, premises]);
  const info = useQuery({ queryKey: ['self-checkin', business, premises], queryFn: desk.info, retry: false });

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [session, setSession] = useState<SelfCheckInSession | null>(null);
  const [location, setLocation] = useState<GeoPosition | undefined>();
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [purpose, setPurpose] = useState('');
  const [hostQuery, setHostQuery] = useState('');
  const [host, setHost] = useState<{ id: string; name: string } | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const uploadedKey = useRef<string | null>(null);

  const hosts = useQuery({
    queryKey: ['self-checkin-hosts', business, premises, hostQuery],
    queryFn: () => desk.hosts(session!.sessionToken, hostQuery.trim()),
    enabled: step === 'details' && !!session && hostQuery.trim().length >= 2 && !host,
  });

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

  function sendOtp(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeIndianPhone(phone);
    if (!normalized) {
      setError('Enter a valid 10-digit mobile number.');
      return;
    }
    void run(async () => {
      await desk.requestOtp(normalized);
      setStep('otp');
    });
  }

  function verify(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const where = info.data?.needsLocation ? await currentPosition() : undefined;
      setLocation(where);
      try {
        const result = await desk.verify({ phone, otp, location: where });
        setSession(result);
        const active = result.activeVisit;
        if (active?.status === 'CHECKED_IN') {
          setStep('checked-in');
        } else if (active) {
          // An open visit already exists here: its page shows the pass, the form or the status.
          navigate(`/v/${active.token}`, { replace: true });
        } else {
          setName(result.visitor?.name ?? '');
          setCompany(result.visitor?.company ?? '');
          setPurpose(info.data?.purposes[0] ?? '');
          setStep('details');
        }
      } catch (e) {
        setOtp('');
        throw e;
      }
    });
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

  const needsPhoto = !session?.visitor?.hasPhoto;
  const canSubmit = !!name.trim() && !!purpose.trim() && !!host && consent && (!needsPhoto || !!photo) && !busy;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!session || !host || !canSubmit) return;
    void run(async () => {
      // On retry, do not upload the photo again.
      if (photo) uploadedKey.current ??= (await desk.uploadPhoto(session.sessionToken, photo)).key;
      const result = await desk.checkIn(session.sessionToken, {
        name: name.trim(),
        company: company.trim() || undefined,
        purpose: purpose.trim(),
        hostId: host.id,
        photoKey: uploadedKey.current ?? undefined,
        consent,
        location,
      });
      navigate(`/v/${result.token}`, { replace: true });
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
    return <Shell title={missing ? 'This check-in link is not valid' : 'Something went wrong'}>{!missing && <p className="muted">{errorMessage(info.error)}</p>}</Shell>;
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

  if (step === 'phone') {
    return (
      <Shell title="Visitor check-in" subtitle={subtitle}>
        <p className="muted">Check in with your mobile number. No app needed.</p>
        <form className="stack" onSubmit={sendOtp}>
          <label htmlFor="sc-phone">Mobile number</label>
          <input id="sc-phone" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          <button type="submit" className="primary" disabled={busy}>
            Send OTP
          </button>
        </form>
        {alert}
      </Shell>
    );
  }

  if (step === 'otp') {
    return (
      <Shell title="Enter the OTP" subtitle={subtitle}>
        <p className="muted">
          We sent a 6-digit code to {phone}.
          {place.needsLocation && ' We will also check that you are at the premises.'}
        </p>
        <form className="stack" onSubmit={verify}>
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
          <button type="submit" className="primary" disabled={busy || otp.length !== 6}>
            {busy ? 'Please wait…' : 'Verify'}
          </button>
          <button type="button" className="link" onClick={() => setStep('phone')}>
            Change number
          </button>
        </form>
        {alert}
      </Shell>
    );
  }

  return (
    <Shell title={session?.visitor ? `Welcome back, ${session.visitor.name}` : 'Your details'} subtitle={subtitle}>
      <form className="stack" onSubmit={submit}>
        <label htmlFor="sc-name">Your name</label>
        <input id="sc-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />

        <label htmlFor="sc-company">Company</label>
        <input id="sc-company" value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="organization" />

        <label htmlFor="sc-purpose">Purpose of visit</label>
        <select id="sc-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} required>
          {place.purposes.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>

        <label htmlFor="sc-host">Who are you meeting?</label>
        {host ? (
          <div className="row">
            <strong>{host.name}</strong>
            <button type="button" className="link" onClick={() => setHost(null)}>
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              id="sc-host"
              placeholder="Type at least 2 letters of the name"
              value={hostQuery}
              onChange={(e) => setHostQuery(e.target.value)}
            />
            <div className="stack" style={{ gap: 6 }}>
              {hosts.data?.map((h) => (
                <button type="button" key={h.id} onClick={() => setHost({ id: h.id, name: h.name })}>
                  {h.name}
                  {h.department ? ` (${h.department})` : ''}
                </button>
              ))}
              {hosts.data?.length === 0 && <p className="muted small">No one found with that name.</p>}
            </div>
          </>
        )}

        <label htmlFor="sc-photo">{needsPhoto ? 'Your photo' : 'New photo (optional)'}</label>
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
        <button type="submit" className="primary" disabled={!canSubmit}>
          {busy ? 'Please wait…' : 'Send to host'}
        </button>
      </form>
    </Shell>
  );
}
