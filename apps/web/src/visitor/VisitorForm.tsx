import type { PublicInvite } from '@visitor/shared';
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage, useApi } from '../api';
import { compressPhoto, PhotoError } from './compressPhoto';

const ID_TYPES = ['Aadhaar', 'PAN', 'Driving licence', 'Voter ID', 'Company ID', 'Passport'];

interface Props {
  token: string;
  invite: PublicInvite;
  onDone(invite: PublicInvite): void;
}

export function VisitorForm({ token, invite, onDone }: Props) {
  const api = useApi();
  const [name, setName] = useState(invite.visitorName);
  const [company, setCompany] = useState('');
  const [idType, setIdType] = useState('');
  const [idLast4, setIdLast4] = useState('');
  const [consent, setConsent] = useState(false);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const uploadedKey = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

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

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !photo || !consent) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      // On retry, do not upload the photo again.
      uploadedKey.current ??= (await api.publicInvites.uploadPhoto(token, photo)).key;
      const result = await api.publicInvites.register(token, {
        name: name.trim(),
        company: company.trim() || undefined,
        photoKey: uploadedKey.current,
        idType: idType || undefined,
        idLast4: idLast4 || undefined,
        consent,
      });
      onDone(result);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const idIncomplete = idLast4.length > 0 && idLast4.length !== 4;
  const canSubmit = !!name.trim() && !!photo && consent && !busy && !idIncomplete;

  return (
    <form className="form-card" onSubmit={submit}>
      <div>
        <div className="eyebrow">{invite.siteName}</div>
        <h1>Fill in your details</h1>
        <p className="muted">{invite.hostName} has invited you.</p>
      </div>

      <div className="stack">
        <label htmlFor="visitor-name">Your name</label>
        <input id="visitor-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
      </div>

      <div className="stack">
        <label htmlFor="visitor-company">Company</label>
        <input id="visitor-company" value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="organization" />
      </div>

      <div className="stack">
        <label htmlFor="visitor-photo">Your photo</label>
        <input id="visitor-photo" type="file" accept="image/*" capture="user" onChange={choosePhoto} />
        {preview && <img src={preview} alt="Selected photo" className="photo-preview" />}
        <p className="muted">The guard uses this to recognise you at the gate.</p>
      </div>

      <div className="form-grid">
        <div>
          <label htmlFor="visitor-id-type">ID type</label>
          <select id="visitor-id-type" value={idType} onChange={(e) => setIdType(e.target.value)}>
            <option value="">Prefer not to say</option>
            {ID_TYPES.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="visitor-id-last4">Last 4 digits of ID</label>
          <input
            id="visitor-id-last4"
            inputMode="numeric"
            maxLength={4}
            value={idLast4}
            onChange={(e) => setIdLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
          />
        </div>
      </div>
      <p className="muted">Never enter your full ID number. Only the last 4 digits are stored.</p>

      <label className="check">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>
          I agree that my details and photo will be stored for the visitor record.{' '}
          <Link to="/privacy">Privacy notice</Link>
        </span>
      </label>

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      <button type="submit" className="primary" disabled={!canSubmit}>
        {busy ? 'Please wait…' : 'Get my pass'}
      </button>
    </form>
  );
}
