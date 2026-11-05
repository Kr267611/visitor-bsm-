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
      setError(e instanceof PhotoError ? e.message : 'Yeh photo nahi chal rahi. Camera se nayi photo lein.');
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !photo || !consent) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      // Dobara koshish par photo phir se upload nahi.
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
        <h1>Apni details bharein</h1>
        <p className="muted">{invite.hostName} ne aapko bulaya hai.</p>
      </div>

      <div className="stack">
        <label htmlFor="visitor-name">Aapka naam</label>
        <input id="visitor-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
      </div>

      <div className="stack">
        <label htmlFor="visitor-company">Company</label>
        <input id="visitor-company" value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="organization" />
      </div>

      <div className="stack">
        <label htmlFor="visitor-photo">Aapki photo</label>
        <input id="visitor-photo" type="file" accept="image/*" capture="user" onChange={choosePhoto} />
        {preview && <img src={preview} alt="Chuni gayi photo" className="photo-preview" />}
        <p className="muted">Guard gate par isse aapko pehchanega.</p>
      </div>

      <div className="form-grid">
        <div>
          <label htmlFor="visitor-id-type">ID type</label>
          <select id="visitor-id-type" value={idType} onChange={(e) => setIdType(e.target.value)}>
            <option value="">Nahi batana</option>
            {ID_TYPES.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="visitor-id-last4">ID ke aakhri 4 digit</label>
          <input
            id="visitor-id-last4"
            inputMode="numeric"
            maxLength={4}
            value={idLast4}
            onChange={(e) => setIdLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
          />
        </div>
      </div>
      <p className="muted">Poora ID number kabhi na daalein. Sirf aakhri 4 digit save hote hain.</p>

      <label className="check">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>
          Main sahmat hoon ki meri details aur photo visitor record ke liye save hongi.{' '}
          <Link to="/privacy">Privacy notice</Link>
        </span>
      </label>

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      <button type="submit" className="primary" disabled={!canSubmit}>
        {busy ? 'Ho raha hai…' : 'Pass banayein'}
      </button>
    </form>
  );
}
