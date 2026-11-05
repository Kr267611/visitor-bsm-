import type { VisitSummary } from '@visitor/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage, useApi } from '../api';
import { useAuth } from '../auth/AuthProvider';
import { useLive } from './LiveSiteContext';
import { DASHBOARD_KEY } from './useLiveSite';
import { VisitRow } from './VisitRow';

const GATE_KEY = 'visitor.gate';

export type DeskSection = 'pending' | 'expected' | 'inside';

const TITLES: Record<DeskSection, string> = {
  pending: 'Approval baaki',
  expected: 'Aane wale',
  inside: 'Andar hain',
};

function storedGate(): string {
  try {
    return localStorage.getItem(GATE_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberGate(id: string): void {
  try {
    localStorage.setItem(GATE_KEY, id);
  } catch {
    // Storage na mile to har baar gate chunna padega, bas.
  }
}

/** Ek kaam ki ek id, taaki network retry par doosri entry na bane. */
function useEventId() {
  const id = useRef<string | null>(null);
  return {
    current: () => (id.current ??= crypto.randomUUID()),
    done: () => {
      id.current = null;
    },
  };
}

function useAction() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      await queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY });
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error };
}

const ActionError = ({ message }: { message: string | null }) =>
  message ? (
    <p role="alert" className="error" style={{ width: '100%' }}>
      {message}
    </p>
  ) : null;

function CheckOutAction({ visit, gateId }: { visit: VisitSummary; gateId: string }) {
  const api = useApi();
  const eventId = useEventId();
  const { run, busy, error } = useAction();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} disabled={!gateId}>
        Check-out
      </button>
    );
  }
  return (
    <div className="confirm">
      <button
        type="button"
        className="danger"
        disabled={busy}
        onClick={async () => {
          const ok = await run(() => api.visits.checkOut(visit.id, { gateId, clientEventId: eventId.current() }));
          if (ok) eventId.done();
        }}
      >
        Haan, check-out karein
      </button>
      <button type="button" onClick={() => setConfirming(false)}>
        Nahi
      </button>
      <ActionError message={error} />
    </div>
  );
}

function CheckInAction({ visit, gateId }: { visit: VisitSummary; gateId: string }) {
  const api = useApi();
  const eventId = useEventId();
  const { run, busy, error } = useAction();
  return (
    <>
      <button
        type="button"
        disabled={busy || !gateId}
        onClick={async () => {
          const ok = await run(() => api.visits.checkIn(visit.id, { gateId, clientEventId: eventId.current() }));
          if (ok) eventId.done();
        }}
      >
        Check-in
      </button>
      <ActionError message={error} />
    </>
  );
}

function DecisionActions({ visit }: { visit: VisitSummary }) {
  const api = useApi();
  const { run, busy, error } = useAction();
  return (
    <>
      <button type="button" disabled={busy} onClick={() => void run(() => api.visits.approve(visit.id))}>
        Approve
      </button>
      <button type="button" className="danger" disabled={busy} onClick={() => void run(() => api.visits.reject(visit.id))}>
        Reject
      </button>
      <ActionError message={error} />
    </>
  );
}

function matches(visit: VisitSummary, search: string) {
  const q = search.trim().toLowerCase();
  return !q || visit.visitorName.toLowerCase().includes(q) || visit.code.toLowerCase().includes(q);
}

export function DeskPage({ section }: { section: DeskSection }) {
  const api = useApi();
  const { user } = useAuth();
  const { query, connected } = useLive();
  const gates = useQuery({ queryKey: ['gates'], queryFn: () => api.gates.list() });
  const [gateId, setGateId] = useState(storedGate);
  const [search, setSearch] = useState('');

  const canGate = user?.role === 'guard' || user?.role === 'reception';
  const canDecide = user?.role === 'reception' || user?.role === 'admin';

  useEffect(() => {
    const list = gates.data;
    if (list?.length && !list.some((g) => g.id === gateId)) setGateId(list[0].id);
  }, [gates.data, gateId]);

  const data = query.data;
  const filter = (rows: VisitSummary[] = []) => rows.filter((v) => matches(v, search));

  let body: ReactNode = null;
  if (data && section === 'pending') {
    const calls = data.needsCall.filter((v) => matches(v, search));
    const pending = filter(data.pending);
    body = (
      <>
        {calls.length > 0 && (
          <section className="panel panel-urgent">
            <h2>
              <span>Host ko call karein</span>
              <span className="mono">{calls.length}</span>
            </h2>
            {calls.map((visit) => (
              <VisitRow
                key={visit.id}
                visit={visit}
                note={
                  <span>
                    {visit.hostName} ko call karein: <span className="mono">{visit.hostPhone}</span>
                  </span>
                }
              >
                {canDecide && <DecisionActions visit={visit} />}
              </VisitRow>
            ))}
          </section>
        )}
        <section className="panel">
          {pending.length === 0 && <p className="empty">Koi approval baaki nahi hai.</p>}
          {pending.map((visit) => (
            <VisitRow key={visit.id} visit={visit}>
              {canDecide && <DecisionActions visit={visit} />}
            </VisitRow>
          ))}
        </section>
      </>
    );
  } else if (data && section === 'expected') {
    const rows = filter(data.expected);
    body = (
      <section className="panel">
        {rows.length === 0 && <p className="empty">Aaj aur koi visitor aane wala nahi hai.</p>}
        {rows.map((visit) => (
          <VisitRow key={visit.id} visit={visit}>
            {canGate && visit.status === 'APPROVED' && <CheckInAction visit={visit} gateId={gateId} />}
          </VisitRow>
        ))}
      </section>
    );
  } else if (data) {
    const rows = filter(data.inside);
    body = (
      <section className="panel">
        {rows.length === 0 && <p className="empty">Abhi koi visitor andar nahi hai.</p>}
        {rows.map((visit) => (
          <VisitRow key={visit.id} visit={visit}>
            {canGate && <CheckOutAction visit={visit} gateId={gateId} />}
          </VisitRow>
        ))}
      </section>
    );
  }

  const callsWaiting = data?.needsCall.length ?? 0;

  return (
    <>
      <div className="spread">
        <h1>{TITLES[section]}</h1>
        {!!gates.data && gates.data.length > 1 && canGate && (
          <div className="row">
            <label htmlFor="desk-gate">Aapka gate</label>
            <select
              id="desk-gate"
              style={{ width: 'auto' }}
              value={gateId}
              onChange={(e) => {
                setGateId(e.target.value);
                rememberGate(e.target.value);
              }}
            >
              {gates.data.map((gate) => (
                <option key={gate.id} value={gate.id}>
                  {gate.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {section !== 'pending' && callsWaiting > 0 && (
        <Link to="/desk/pending" className="notice notice-link">
          {callsWaiting} host ko call karna baaki hai. Dekhein
        </Link>
      )}
      {!connected && <p className="notice">Live nahi hai. List har 30 second mein update ho rahi hai.</p>}
      {query.isError && (
        <p role="alert" className="error">
          {errorMessage(query.error)}
        </p>
      )}

      <div className="stack">
        <label htmlFor="desk-search">Naam ya code se dhoondein</label>
        <input id="desk-search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {body}
    </>
  );
}
