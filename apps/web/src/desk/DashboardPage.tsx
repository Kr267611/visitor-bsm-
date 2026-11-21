import type { StatCount, StatsPeriod } from '@visitor/shared';
import { useQuery } from '@tanstack/react-query';
import { ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage, useApi } from '../api';
import { EmptyState, PageHeader } from '../ui/Page';
import { StatusBadge } from '../ui/StatusBadge';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PERIOD_LABEL: Record<StatsPeriod, string> = { today: 'Today', month: 'This month', year: 'This year' };
const TIME = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
const NUMBER = new Intl.NumberFormat('en-IN');

/** Small line icons for the cards. */
const ICON: Record<string, ReactNode> = {
  visits: <path d="M4 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M17 4.5a3.5 3.5 0 0 1 0 6.5M20 20v-1a5 5 0 0 0-3-4.6" />,
  invites: <path d="M3 7l9 6 9-6M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1" />,
  walkIns: <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" />,
  rejected: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M5.6 5.6l12.8 12.8" />,
  people: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />,
  inside: <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M9 8l4 4-4 4M13 12H3" />,
};

function Icon({ name, tone }: { name: keyof typeof ICON; tone: string }) {
  return (
    <span className={`stat-icon stat-icon-${tone}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {ICON[name]}
      </svg>
    </span>
  );
}

/** One card: today's number large, this month and all-time below. */
function StatCard({ title, todayLabel, count, icon, tone }: { title: string; todayLabel: string; count: StatCount; icon: keyof typeof ICON; tone: string }) {
  return (
    <section className="stat-card" aria-label={title}>
      <div className="stat-top">
        <div>
          <h2>{title}</h2>
          <p className="stat-today">
            <strong>{NUMBER.format(count.today)}</strong> <span>{todayLabel}</span>
          </p>
        </div>
        <Icon name={icon} tone={tone} />
      </div>
      <dl className="stat-rows">
        <div>
          <dt>This month</dt>
          <dd className="pill pill-good">{NUMBER.format(count.month)}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd className="pill pill-accent">{NUMBER.format(count.total)}</dd>
        </div>
      </dl>
    </section>
  );
}

function BigNumber({ title, value, hint, icon, tone, to }: { title: string; value: number; hint: string; icon: keyof typeof ICON; tone: string; to?: string }) {
  return (
    <section className="stat-card stat-card-big" aria-label={title}>
      <div className="stat-top">
        <div>
          <h2>{title}</h2>
          <p className="stat-big">{NUMBER.format(value)}</p>
          <p className="muted small">{to ? <Link to={to}>{hint}</Link> : hint}</p>
        </div>
        <Icon name={icon} tone={tone} />
      </div>
    </section>
  );
}

/** Ranked horizontal bars: names stay readable however many hosts there are. */
function HostChart({ rows }: { rows: { name: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="hbar-chart" aria-label="Visits per host">
      {rows.map((r) => (
        <li key={r.name} title={`${r.name}: ${r.count} ${r.count === 1 ? 'visit' : 'visits'}`}>
          <span className="hbar-name">{r.name}</span>
          <span className="hbar-track">
            <span className="hbar-fill" style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <span className="hbar-value">{NUMBER.format(r.count)}</span>
        </li>
      ))}
    </ul>
  );
}

/** "Nice" top of the axis so grid lines fall on round numbers. */
function niceMax(value: number): number {
  if (value <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= value) return m * step;
  return 10 * step;
}

/** Twelve columns, one per month. Hover a column to see its number. */
function MonthChart({ counts, year, currentMonth }: { counts: number[]; year: number; currentMonth: number }) {
  const top = niceMax(Math.max(...counts));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(top * f));
  return (
    <div className="vbar-chart">
      <div className="vbar-axis" aria-hidden="true">
        {[...ticks].reverse().map((t) => (
          <span key={t}>{NUMBER.format(t)}</span>
        ))}
      </div>
      <div className="vbar-plot">
        <div className="vbar-grid" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} />
          ))}
        </div>
        <ol className="vbar-cols" aria-label={`Visits per month in ${year}`}>
          {counts.map((n, i) => (
            <li key={MONTHS[i]} className={i === currentMonth ? 'is-current' : undefined} aria-label={`${MONTHS[i]}: ${n} visits`} tabIndex={0}>
              <span className="vbar-slot">
                <span className="vbar-tip" role="tooltip">
                  {MONTHS[i]} {year}: <strong>{NUMBER.format(n)}</strong>
                </span>
                <span className="vbar-fill" style={{ height: `${(n / top) * 100}%` }} />
              </span>
              <span className="vbar-label">{MONTHS[i]}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const api = useApi();
  const [period, setPeriod] = useState<StatsPeriod>('month');
  const stats = useQuery({
    queryKey: ['dashboard', 'stats', period],
    queryFn: () => api.dashboard.stats(period),
    refetchInterval: 60_000,
    placeholderData: (previous) => previous,
  });

  if (stats.isError) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <p role="alert" className="error">
          {errorMessage(stats.error)}
        </p>
      </>
    );
  }
  const s = stats.data;
  if (!s) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <p className="muted">Loading…</p>
      </>
    );
  }
  const currentMonth = new Date(Date.now() + 5.5 * 3600_000).getUTCMonth();

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Visitors at this premises: today, this month and all time." />

      <div className="stat-grid">
        <StatCard title="Visits" todayLabel="came in today" count={s.visits} icon="visits" tone="blue" />
        <StatCard title="Invites" todayLabel="sent today" count={s.invites} icon="invites" tone="peach" />
        <StatCard title="Walk-in & QR requests" todayLabel="today" count={s.walkIns} icon="walkIns" tone="green" />
        <StatCard title="Rejected" todayLabel="today" count={s.rejected} icon="rejected" tone="red" />
        <BigNumber title="Total visitors" value={s.totalVisitors} hint="Different people who have come in" icon="people" tone="green" />
        <BigNumber
          title="Inside now"
          value={s.insideNow}
          hint={s.waitingNow ? `${s.waitingNow} waiting for approval` : 'Nobody waiting for approval'}
          to={s.waitingNow ? '/desk/pending' : '/desk/inside'}
          icon="inside"
          tone="blue"
        />
      </div>

      <section className="panel chart-panel" aria-label="Host-wise visits">
        <div className="panel-head">
          <h2>Host-wise visits</h2>
          <select aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value as StatsPeriod)}>
            {(Object.keys(PERIOD_LABEL) as StatsPeriod[]).map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="chart-body">
          {s.hostWise.length ? (
            <HostChart rows={s.hostWise} />
          ) : (
            <p className="muted">No visits {period === 'today' ? 'today' : period === 'month' ? 'this month' : 'this year'} yet.</p>
          )}
        </div>
      </section>

      <section className="panel chart-panel" aria-label="Month-wise visits">
        <div className="panel-head">
          <h2>Month-wise visits</h2>
          <span className="muted small">
            {s.year}: {NUMBER.format(s.monthWise.reduce((a, b) => a + b, 0))} visits
          </span>
        </div>
        <div className="chart-body">
          <MonthChart counts={s.monthWise} year={s.year} currentMonth={currentMonth} />
        </div>
      </section>

      <section className="panel table-scroll" aria-label="Today's visitors">
        <div className="panel-head">
          <h2>Today's visitors</h2>
          <Link to="/desk/pending" className="small">
            Open gate desk
          </Link>
        </div>
        {s.todayVisits.length ? (
          <table>
            <thead>
              <tr>
                <th>Visitor</th>
                <th>Host</th>
                <th>Purpose</th>
                <th>Came in</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {s.todayVisits.map((v) => (
                <tr key={v.id}>
                  <td>
                    <strong>{v.visitorName}</strong>
                    {v.company && <span className="cell-sub">{v.company}</span>}
                  </td>
                  <td>{v.hostName}</td>
                  <td className="cell-wrap">{v.purposeNote ? `${v.purpose} — ${v.purposeNote}` : v.purpose}</td>
                  <td>{v.checkedInAt ? TIME.format(new Date(v.checkedInAt)) : '-'}</td>
                  <td>
                    <StatusBadge status={v.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="No visitors today yet." hint="Requests and arrivals show up here as they happen." />
        )}
      </section>
    </>
  );
}
