import type { GatePass } from '@visitor/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { errorMessage, useApi } from '../api';

const WHEN = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Kolkata',
});

export const formatWhen = (iso: string | null) => (iso ? WHEN.format(new Date(iso)) : '-');

/** "1 h 25 min", "40 min", "2 d 3 h". Empty when the visitor has not left yet. */
export function timeInside(inAt: string | null, outAt: string | null): string {
  if (!inAt || !outAt) return '';
  const minutes = Math.max(0, Math.round((new Date(outAt).getTime() - new Date(inAt).getTime()) / 60_000));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d) return `${d} d ${h} h`;
  return h ? `${h} h ${m} min` : `${m} min`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

/** The exit slip: what the guard keeps, printed or on record. */
export function GatePassSlip({ pass }: { pass: GatePass }) {
  const out = pass.status === 'CHECKED_OUT';
  return (
    <article className="gate-pass" aria-label={`Gate pass ${pass.gatePassNo ?? pass.visitCode}`}>
      <header className="gate-pass-head">
        <div>
          <strong>{pass.businessName}</strong>
          <span>{pass.premisesName}</span>
        </div>
        <div className="gate-pass-no">
          <span>{out ? 'Gate pass' : 'Visitor slip'}</span>
          <strong>{pass.gatePassNo ?? pass.visitCode}</strong>
        </div>
      </header>

      <div className="gate-pass-who">
        {pass.photoUrl ? <img src={pass.photoUrl} alt="" className="gate-pass-photo" /> : null}
        <div>
          <strong className="gate-pass-name">{pass.visitorName}</strong>
          <span>{[pass.company, pass.phone].filter(Boolean).join(' · ')}</span>
        </div>
      </div>

      <dl className="gate-pass-rows">
        <Row label="Met">{pass.hostName}</Row>
        <Row label="Purpose">{pass.purposeNote ? `${pass.purpose} — ${pass.purposeNote}` : pass.purpose}</Row>
        <Row label="In">
          {formatWhen(pass.inAt)}
          {pass.inGate && <small> · {pass.inGate}</small>}
        </Row>
        <Row label="Out">
          {out ? formatWhen(pass.outAt) : 'Not checked out yet'}
          {out && pass.outGate && <small> · {pass.outGate}</small>}
        </Row>
        {out && <Row label="Time inside">{timeInside(pass.inAt, pass.outAt)}</Row>}
        <Row label="Items carried out">{pass.itemsOut || 'None'}</Row>
        {pass.checkedOutBy && <Row label="Checked out by">{pass.checkedOutBy}</Row>}
        <Row label="Visit">{pass.visitCode}</Row>
      </dl>

      <footer className="gate-pass-sign">
        <span>Visitor signature</span>
        <span>Security signature</span>
      </footer>
    </article>
  );
}

export function GatePassPage() {
  const { id = '' } = useParams();
  const api = useApi();
  const pass = useQuery({ queryKey: ['gate-pass', id], queryFn: () => api.gatePasses.get(id) });

  return (
    <>
      <div className="row no-print">
        <Link to="/desk/inside">‹ Inside</Link>
        <Link to="/desk/register">Gate register</Link>
      </div>
      {pass.isError && (
        <p role="alert" className="error">
          {errorMessage(pass.error)}
        </p>
      )}
      {pass.isPending && <p className="muted">Loading…</p>}
      {pass.data && (
        <>
          <div className="row no-print">
            <h1 style={{ flex: 1 }}>{pass.data.gatePassNo ? 'Gate pass' : 'Visitor slip'}</h1>
            <button type="button" className="primary" onClick={() => window.print()}>
              Print
            </button>
          </div>
          <GatePassSlip pass={pass.data} />
        </>
      )}
    </>
  );
}
