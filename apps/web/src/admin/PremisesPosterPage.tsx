import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { Link, useParams } from 'react-router-dom';
import { errorMessage, useApi } from '../api';

/** Address the premises QR points to. */
export const selfCheckInUrl = (origin: string, businessSlug: string, premisesSlug: string) =>
  `${origin}/p/${encodeURIComponent(businessSlug)}/${encodeURIComponent(premisesSlug)}`;

/** Printable poster for the entrance: visitors scan it to check themselves in. */
export function PremisesPosterPage() {
  const { id = '' } = useParams();
  const api = useApi();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me.get() });
  const premises = useQuery({ queryKey: ['admin', 'premises'], queryFn: () => api.admin.premises.list() });

  if (me.isError || premises.isError) {
    return (
      <p role="alert" className="error page-message">
        {errorMessage(me.error ?? premises.error)}
      </p>
    );
  }
  if (!me.data || !premises.data) return <p className="page-message">Loading…</p>;
  const place = premises.data.find((p) => p.id === id);
  if (!place || !me.data.business) return <p className="page-message">Premises not found.</p>;
  const url = selfCheckInUrl(window.location.origin, me.data.business.slug, place.webSlug);

  return (
    <main className="poster-page">
      <div className="poster-tools no-print">
        <Link to="/admin/premises">Back</Link>
        <button type="button" className="primary" onClick={() => window.print()}>
          Print poster
        </button>
      </div>
      <article className="poster" aria-label="QR poster">
        <div className="eyebrow">{me.data.business.name}</div>
        <h1>Visitor check-in</h1>
        <p className="poster-place">{place.name}</p>
        <div className="poster-qr" role="img" aria-label={`QR code for ${url}`}>
          <QRCodeSVG value={url} size={300} level="M" marginSize={2} />
        </div>
        <ol className="poster-steps">
          <li>Scan with your phone camera</li>
          <li>Verify your mobile number</li>
          <li>Choose who you are meeting</li>
          <li>Show your pass to the guard</li>
        </ol>
        <p className="mono poster-url">{url}</p>
        <p className="muted small">Leaving? Scan again to check out.</p>
      </article>
    </main>
  );
}
