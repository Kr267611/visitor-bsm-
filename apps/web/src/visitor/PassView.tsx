import type { PublicInvite } from '@visitor/shared';
import { QRCodeSVG } from 'qrcode.react';

const DATE = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
const TIME = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

export function PassView({ invite }: { invite: PublicInvite }) {
  const from = new Date(invite.validFrom);
  const to = new Date(invite.validTo);
  return (
    <div className="pass-card">
      <div className="eyebrow">Visitor pass</div>
      <div className="pass-name">{invite.visitorName}</div>
      <div className="pass-qr" role="img" aria-label="Visitor pass ka QR code">
        <QRCodeSVG value={invite.pass ?? ''} size={224} level="M" />
      </div>
      {invite.status === 'CHECKED_IN' ? (
        <p>Aap andar hain. Jaate waqt yeh QR gate par dikhayein.</p>
      ) : (
        <p>Gate par yeh QR guard ko dikhayein.</p>
      )}
      <dl className="pass-meta">
        <dt>Host</dt>
        <dd>{invite.hostName}</dd>
        <dt>Site</dt>
        <dd>{invite.siteName}</dd>
        <dt>Time</dt>
        <dd>
          {DATE.format(from)}, {TIME.format(from)} – {TIME.format(to)}
        </dd>
      </dl>
    </div>
  );
}
