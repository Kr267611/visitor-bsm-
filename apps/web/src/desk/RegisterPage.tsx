import type { GatePass } from '@visitor/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage, useApi } from '../api';
import { EmptyState, PageHeader } from '../ui/Page';
import { StatusBadge } from '../ui/StatusBadge';
import { formatWhen, timeInside } from './GatePassPage';

const TIME = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
const DAY = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
const time = (iso: string | null) => (iso ? TIME.format(new Date(iso)) : '-');

/** Today's date in India as YYYY-MM-DD. */
export function istToday(now = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

const CSV_HEAD = ['Gate pass', 'Visit', 'Visitor', 'Company', 'Mobile', 'Purpose', 'About', 'Met', 'In', 'Out', 'Time inside', 'Items carried out', 'Status'];

export function toCsv(rows: GatePass[]): string {
  const cell = (v: string | null | undefined) => {
    const text = v ?? '';
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = rows.map((p) =>
    [
      p.gatePassNo,
      p.visitCode,
      p.visitorName,
      p.company,
      p.phone,
      p.purpose,
      p.purposeNote,
      p.hostName,
      p.inAt ? formatWhen(p.inAt) : '',
      p.outAt ? formatWhen(p.outAt) : '',
      timeInside(p.inAt, p.outAt),
      p.itemsOut,
      p.status === 'CHECKED_OUT' ? 'Left' : 'Inside',
    ]
      .map(cell)
      .join(','),
  );
  // The BOM makes Excel read Hindi and other non-English names correctly.
  return '﻿' + [CSV_HEAD.join(','), ...lines].join('\r\n');
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Who came in on the chosen days: in and out times, time inside, items, and each gate pass. */
export function RegisterPage() {
  const api = useApi();
  const today = istToday();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [q, setQ] = useState('');
  const search = q.trim();
  const passes = useQuery({
    queryKey: ['gate-passes', from, to, search],
    queryFn: () => api.gatePasses.list(from, to, search),
    enabled: !!from && !!to,
    placeholderData: (previous) => previous,
  });
  const rows = passes.data ?? [];
  const inside = rows.filter((p) => p.status === 'CHECKED_IN').length;

  return (
    <>
      <PageHeader
        title="Gate register"
        subtitle="Everyone who came in: in and out times, time inside, items carried out, and the gate pass to print."
        actions={
          <button type="button" disabled={!rows.length} onClick={() => download(`gate-register-${from}-to-${to}.csv`, toCsv(rows))}>
            Download Excel (CSV)
          </button>
        }
      />
      <section className="panel filter-panel" aria-label="Choose dates">
        <div className="filters">
          <input type="search" aria-label="Search the register" placeholder="Name, mobile, company or pass number…" value={q} onChange={(e) => setQ(e.target.value)} />
          <input type="date" aria-label="From date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" aria-label="To date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
        </div>
      </section>
      {passes.isError && (
        <p role="alert" className="error">
          {errorMessage(passes.error)}
        </p>
      )}
      <section className="panel table-scroll" aria-label="Register">
        <div className="panel-head">
          <h2>Visitors</h2>
          <span className="muted small">{passes.data ? `${rows.length} came in, ${inside} still inside` : 'Loading…'}</span>
        </div>
        {rows.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Visitor</th>
                <th>Purpose</th>
                <th>Met</th>
                <th>In</th>
                <th>Out</th>
                <th>Time inside</th>
                <th>Items out</th>
                <th>Gate pass</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.visitId} className={p.status === 'CHECKED_IN' ? 'row-inside' : undefined}>
                  <td>
                    <strong>{p.visitorName}</strong>
                    <span className="cell-sub">{[p.company, p.phone].filter(Boolean).join(' · ')}</span>
                  </td>
                  <td className="cell-wrap">{p.purposeNote ? `${p.purpose} — ${p.purposeNote}` : p.purpose}</td>
                  <td>{p.hostName}</td>
                  <td className="nowrap">
                    {time(p.inAt)}
                    {from !== to && p.inAt && <span className="cell-sub">{DAY.format(new Date(p.inAt))}</span>}
                  </td>
                  <td className="nowrap">{p.status === 'CHECKED_OUT' ? time(p.outAt) : <StatusBadge status={p.status} />}</td>
                  <td className="nowrap">{timeInside(p.inAt, p.outAt) || '-'}</td>
                  <td className="cell-wrap">{p.itemsOut || '-'}</td>
                  <td className="nowrap">
                    <Link to={`/desk/gate-pass/${p.visitId}`} aria-label={`Gate pass of ${p.visitorName}`}>
                      {p.gatePassNo ?? 'Slip'}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {passes.data && rows.length === 0 && <EmptyState title="Nobody came in on these dates." hint="Pick other dates or clear the search." />}
      </section>
    </>
  );
}
