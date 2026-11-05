import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeServer, Handlers, json, renderApp, signIn, USERS } from '../test/harness';

type Listener = (payload?: unknown) => void;
const socket = vi.hoisted(() => ({
  listeners: new Map<string, Listener>(),
  on(event: string, fn: Listener) {
    this.listeners.set(event, fn);
    return this;
  },
  disconnect: () => undefined,
  connect: vi.fn(),
  fire(event: string, payload?: unknown) {
    this.listeners.get(event)?.(payload);
  },
}));
vi.mock('socket.io-client', () => ({ io: () => socket }));

const visit = (id: string, over: object = {}) => ({
  id,
  code: `VIS-2026-${id}`,
  status: 'APPROVED',
  visitorName: `Visitor ${id}`,
  company: 'ACME',
  photoUrl: null,
  hostName: 'Anita Singh',
  validFrom: '2026-11-05T04:30:00.000Z',
  validTo: '2026-11-05T07:30:00.000Z',
  checkedInAt: null,
  ...over,
});

const dashboard = {
  inside: [visit('in1', { status: 'CHECKED_IN', checkedInAt: '2026-11-05T05:00:00.000Z' })],
  expected: [visit('ex1'), visit('ex2', { status: 'INVITED' })],
  pending: [visit('pe1', { status: 'PENDING_APPROVAL' })],
  needsCall: [visit('ca1', { status: 'PENDING_APPROVAL', hostPhone: '+919811111111' })],
};

function server(over: Handlers = {}) {
  return fakeServer({
    'GET /dashboard/live': () => json(200, dashboard),
    'GET /gates': () => json(200, [{ id: 'g1', name: 'Main Gate 1', siteId: 's1' }]),
    ...over,
  });
}

const panel = async (name: RegExp) => (await screen.findByRole('heading', { name })).closest('section') as HTMLElement;

describe('desk', () => {
  beforeEach(() => {
    socket.listeners.clear();
    signIn(USERS.reception);
  });
  afterEach(() => vi.useRealTimers());

  it('renders 4 lists from dashboard data', async () => {
    renderApp('/desk', server());
    expect(within(await panel(/Host ko call karein/)).getByText('Visitor ca1')).toBeInTheDocument();
    expect(within(await panel(/Approval baaki/)).getByText('Visitor pe1')).toBeInTheDocument();
    expect(within(await panel(/Aane wale/)).getByText('Visitor ex1')).toBeInTheDocument();
    expect(within(await panel(/Andar hain/)).getByText('Visitor in1')).toBeInTheDocument();
  });

  it('needsCall appears first with host name and phone', async () => {
    renderApp('/desk', server());
    const first = await panel(/Host ko call karein/);
    expect(within(first).getByText(/Anita Singh ko call karein/)).toBeInTheDocument();
    expect(within(first).getByText(/\+919811111111/)).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toMatch(/Host ko call karein/);
  });

  it('call panel hidden when nobody needs a call', async () => {
    renderApp('/desk', server({ 'GET /dashboard/live': () => json(200, { ...dashboard, needsCall: [] }) }));
    await panel(/Approval baaki/);
    expect(screen.queryByRole('heading', { name: /Host ko call karein/ })).not.toBeInTheDocument();
  });

  it('visit.updated refetches dashboard', async () => {
    const s = server();
    renderApp('/desk', s);
    await panel(/Andar hain/);
    act(() => socket.fire('ready'));
    const before = s.calls.filter((c) => c.key === 'GET /dashboard/live').length;
    act(() => socket.fire('visit.updated', { visitId: 'x', status: 'CHECKED_IN' }));
    await waitFor(() =>
      expect(s.calls.filter((c) => c.key === 'GET /dashboard/live').length).toBeGreaterThan(before),
    );
  });

  it('socket down: shows "Live nahi hai" and polls every 30s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const s = server();
    renderApp('/desk', s);
    await panel(/Andar hain/);
    expect(screen.getByText(/Live nahi hai/)).toBeInTheDocument();
    const before = s.calls.filter((c) => c.key === 'GET /dashboard/live').length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await waitFor(() =>
      expect(s.calls.filter((c) => c.key === 'GET /dashboard/live').length).toBeGreaterThan(before),
    );
  });

  it('socket connected: live message gone', async () => {
    renderApp('/desk', server());
    await panel(/Andar hain/);
    act(() => socket.fire('ready'));
    expect(screen.queryByText(/Live nahi hai/)).not.toBeInTheDocument();
    act(() => socket.fire('disconnect'));
    expect(screen.getByText(/Live nahi hai/)).toBeInTheDocument();
  });

  it('ready refetches, so changes during the gap are not missed', async () => {
    const s = server();
    renderApp('/desk', s);
    await panel(/Andar hain/);
    const before = s.calls.filter((c) => c.key === 'GET /dashboard/live').length;
    act(() => socket.fire('ready'));
    await waitFor(() =>
      expect(s.calls.filter((c) => c.key === 'GET /dashboard/live').length).toBeGreaterThan(before),
    );
  });

  it('server disconnect (expired token) refreshes session and reconnects', async () => {
    const s = server({ 'GET /me': () => json(200, { id: 'u' }) });
    renderApp('/desk', s);
    await panel(/Andar hain/);
    socket.connect.mockClear();
    act(() => socket.fire('disconnect', 'io server disconnect'));
    await waitFor(() => expect(socket.connect).toHaveBeenCalled(), { timeout: 5000 });
    expect(s.calls.some((c) => c.key === 'GET /me')).toBe(true);
  }, 10_000);

  it('normal network drop leaves reconnecting to the socket library', async () => {
    renderApp('/desk', server());
    await panel(/Andar hain/);
    socket.connect.mockClear();
    act(() => socket.fire('disconnect', 'transport close'));
    await new Promise((r) => setTimeout(r, 50));
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('dashboard failure shows the message', async () => {
    renderApp('/desk', server({ 'GET /dashboard/live': () => json(500, { error: 'INTERNAL', message: 'Server mein dikkat hai.' }) }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Server mein dikkat hai.');
  });

  it('manual check-out confirms in page, then updates list', async () => {
    const s = server({
      'POST /visits/in1/check-out': () => json(200, { result: 'CHECKED_OUT' }),
    });
    renderApp('/desk', s);
    const user = userEvent.setup();
    const inside = await panel(/Andar hain/);
    await user.click(within(inside).getByRole('button', { name: 'Check-out' }));
    expect(s.calls.some((c) => c.key === 'POST /visits/in1/check-out')).toBe(false);
    s.handlers['GET /dashboard/live'] = () => json(200, { ...dashboard, inside: [] });
    await user.click(within(inside).getByRole('button', { name: 'Haan, check-out karein' }));
    await waitFor(() => expect(screen.queryByText('Visitor in1')).not.toBeInTheDocument());
    const call = s.calls.find((c) => c.key === 'POST /visits/in1/check-out')!;
    expect(call.body.gateId).toBe('g1');
    expect(call.body.clientEventId.length).toBeGreaterThanOrEqual(8);
  });

  it('confirm can be cancelled', async () => {
    const s = server();
    renderApp('/desk', s);
    const user = userEvent.setup();
    const inside = await panel(/Andar hain/);
    await user.click(within(inside).getByRole('button', { name: 'Check-out' }));
    await user.click(within(inside).getByRole('button', { name: 'Nahi' }));
    expect(within(inside).getByRole('button', { name: 'Check-out' })).toBeInTheDocument();
    expect(s.calls.some((c) => c.key.includes('check-out'))).toBe(false);
  });

  it('check-out conflict shows server message', async () => {
    const s = server({
      'POST /visits/in1/check-out': () => json(409, { error: 'NOT_CHECKED_IN', message: 'Yeh visitor andar nahi hai.' }),
    });
    renderApp('/desk', s);
    const user = userEvent.setup();
    const inside = await panel(/Andar hain/);
    await user.click(within(inside).getByRole('button', { name: 'Check-out' }));
    await user.click(within(inside).getByRole('button', { name: 'Haan, check-out karein' }));
    expect(await within(inside).findByRole('alert')).toHaveTextContent('Yeh visitor andar nahi hai.');
  });

  it('check-in only for registered visitors', async () => {
    const s = server({ 'POST /visits/ex1/check-in': () => json(200, { result: 'CHECKED_IN' }) });
    renderApp('/desk', s);
    const expected = await panel(/Aane wale/);
    expect(within(expected).getAllByRole('button', { name: 'Check-in' })).toHaveLength(1);
    await userEvent.setup().click(within(expected).getByRole('button', { name: 'Check-in' }));
    await waitFor(() => expect(s.calls.some((c) => c.key === 'POST /visits/ex1/check-in')).toBe(true));
  });

  it('reception can approve from pending list', async () => {
    const s = server({ 'POST /visits/pe1/approve': () => json(200, { id: 'pe1', status: 'APPROVED' }) });
    renderApp('/desk', s);
    const pending = await panel(/Approval baaki/);
    await userEvent.setup().click(within(pending).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(s.calls.some((c) => c.key === 'POST /visits/pe1/approve')).toBe(true));
  });

  it('security sees lists but no action buttons', async () => {
    signIn(USERS.security);
    renderApp('/desk', server());
    const inside = await panel(/Andar hain/);
    expect(within(inside).queryByRole('button')).toBeNull();
    expect(within(await panel(/Approval baaki/)).queryByRole('button')).toBeNull();
  });

  it('search filters by name or code', async () => {
    renderApp('/desk', server());
    const user = userEvent.setup();
    await panel(/Andar hain/);
    await user.type(screen.getByLabelText('Naam ya code se dhoondein'), 'ex2');
    expect(screen.getByText('Visitor ex2')).toBeInTheDocument();
    expect(screen.queryByText('Visitor in1')).not.toBeInTheDocument();
  });

  it('several gates: chooses one and remembers it', async () => {
    const s = server({
      'GET /gates': () =>
        json(200, [
          { id: 'g1', name: 'Main Gate 1', siteId: 's1' },
          { id: 'g2', name: 'Gate 2', siteId: 's1' },
        ]),
      'POST /visits/in1/check-out': () => json(200, { result: 'CHECKED_OUT' }),
    });
    const { unmount } = renderApp('/desk', s);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Aapka gate'), 'g2');
    unmount();
    renderApp('/desk', s);
    expect(await screen.findByLabelText('Aapka gate')).toHaveValue('g2');
  });
});
