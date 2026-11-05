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

const main = () => screen.getByRole('main');
const liveCalls = (s: ReturnType<typeof server>) => s.calls.filter((c) => c.key === 'GET /dashboard/live').length;

describe('desk pages', () => {
  beforeEach(() => {
    socket.listeners.clear();
    signIn(USERS.reception);
  });
  afterEach(() => vi.useRealTimers());

  it('/desk opens the approval page', async () => {
    renderApp('/desk', server());
    expect(await screen.findByRole('heading', { level: 1, name: 'Approval baaki' })).toBeInTheDocument();
  });

  it('each page shows only its own list', async () => {
    renderApp('/desk/inside', server());
    expect(await screen.findByRole('heading', { level: 1, name: 'Andar hain' })).toBeInTheDocument();
    expect(await within(main()).findByText('Visitor in1')).toBeInTheDocument();
    expect(within(main()).queryByText('Visitor ex1')).not.toBeInTheDocument();
    expect(within(main()).queryByText('Visitor pe1')).not.toBeInTheDocument();
  });

  it('side menu moves between pages without reloading the list', async () => {
    const s = server();
    renderApp('/desk/pending', s);
    const user = userEvent.setup();
    expect(await within(main()).findByText('Visitor pe1')).toBeInTheDocument();
    const before = liveCalls(s);
    await user.click(screen.getByRole('link', { name: /Aane wale/ }));
    expect(await within(main()).findByText('Visitor ex1')).toBeInTheDocument();
    expect(within(main()).queryByText('Visitor pe1')).not.toBeInTheDocument();
    expect(liveCalls(s)).toBe(before);
  });

  it('approval page puts host calls first with host name and phone', async () => {
    renderApp('/desk/pending', server());
    const call = (await screen.findByRole('heading', { name: /Host ko call karein/ })).closest('section') as HTMLElement;
    expect(within(call).getByText(/Anita Singh ko call karein/)).toBeInTheDocument();
    expect(within(call).getByText(/\+919811111111/)).toBeInTheDocument();
    const headings = within(main()).getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toMatch(/Host ko call karein/);
  });

  it('call section hidden when nobody needs a call', async () => {
    renderApp('/desk/pending', server({ 'GET /dashboard/live': () => json(200, { ...dashboard, needsCall: [] }) }));
    await within(main()).findByText('Visitor pe1');
    expect(screen.queryByRole('heading', { name: /Host ko call karein/ })).not.toBeInTheDocument();
  });

  it('other pages warn when a host call is waiting', async () => {
    const user = userEvent.setup();
    renderApp('/desk/inside', server());
    const notice = await screen.findByRole('link', { name: /1 host ko call karna baaki hai/ });
    await user.click(notice);
    expect(await screen.findByRole('heading', { level: 1, name: 'Approval baaki' })).toBeInTheDocument();
  });

  it('empty page says so', async () => {
    renderApp('/desk/inside', server({ 'GET /dashboard/live': () => json(200, { ...dashboard, inside: [] }) }));
    expect(await screen.findByText('Abhi koi visitor andar nahi hai.')).toBeInTheDocument();
  });

  it('visit.updated refetches dashboard', async () => {
    const s = server();
    renderApp('/desk/inside', s);
    await within(main()).findByText('Visitor in1');
    const before = liveCalls(s);
    act(() => socket.fire('visit.updated', { visitId: 'x', status: 'CHECKED_IN' }));
    await waitFor(() => expect(liveCalls(s)).toBeGreaterThan(before));
  });

  it('socket down: shows "Live nahi hai" and polls every 30s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const s = server();
    renderApp('/desk/inside', s);
    await within(main()).findByText('Visitor in1');
    expect(screen.getByText(/Live nahi hai/)).toBeInTheDocument();
    const before = liveCalls(s);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await waitFor(() => expect(liveCalls(s)).toBeGreaterThan(before));
  });

  it('socket connected: live message gone', async () => {
    renderApp('/desk/inside', server());
    await within(main()).findByText('Visitor in1');
    act(() => socket.fire('ready'));
    expect(screen.queryByText(/Live nahi hai/)).not.toBeInTheDocument();
    act(() => socket.fire('disconnect'));
    expect(screen.getByText(/Live nahi hai/)).toBeInTheDocument();
  });

  it('ready refetches, so changes during the gap are not missed', async () => {
    const s = server();
    renderApp('/desk/inside', s);
    await within(main()).findByText('Visitor in1');
    const before = liveCalls(s);
    act(() => socket.fire('ready'));
    await waitFor(() => expect(liveCalls(s)).toBeGreaterThan(before));
  });

  it('server disconnect (expired token) refreshes session and reconnects', async () => {
    const s = server({ 'GET /me': () => json(200, { id: 'u' }) });
    renderApp('/desk/inside', s);
    await within(main()).findByText('Visitor in1');
    socket.connect.mockClear();
    act(() => socket.fire('disconnect', 'io server disconnect'));
    await waitFor(() => expect(socket.connect).toHaveBeenCalled(), { timeout: 5000 });
    expect(s.calls.some((c) => c.key === 'GET /me')).toBe(true);
  }, 10_000);

  it('normal network drop leaves reconnecting to the socket library', async () => {
    renderApp('/desk/inside', server());
    await within(main()).findByText('Visitor in1');
    socket.connect.mockClear();
    act(() => socket.fire('disconnect', 'transport close'));
    await new Promise((r) => setTimeout(r, 50));
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('dashboard failure shows the message', async () => {
    renderApp('/desk/inside', server({ 'GET /dashboard/live': () => json(500, { error: 'INTERNAL', message: 'Server mein dikkat hai.' }) }));
    expect(await within(main()).findByRole('alert')).toHaveTextContent('Server mein dikkat hai.');
  });

  it('manual check-out confirms in page, then updates list', async () => {
    const s = server({ 'POST /visits/in1/check-out': () => json(200, { result: 'CHECKED_OUT' }) });
    renderApp('/desk/inside', s);
    const user = userEvent.setup();
    await user.click(await within(main()).findByRole('button', { name: 'Check-out' }));
    expect(s.calls.some((c) => c.key === 'POST /visits/in1/check-out')).toBe(false);
    s.handlers['GET /dashboard/live'] = () => json(200, { ...dashboard, inside: [] });
    await user.click(within(main()).getByRole('button', { name: 'Haan, check-out karein' }));
    await waitFor(() => expect(screen.queryByText('Visitor in1')).not.toBeInTheDocument());
    const call = s.calls.find((c) => c.key === 'POST /visits/in1/check-out')!;
    expect(call.body.gateId).toBe('g1');
    expect(call.body.clientEventId.length).toBeGreaterThanOrEqual(8);
  });

  it('confirm can be cancelled', async () => {
    const s = server();
    renderApp('/desk/inside', s);
    const user = userEvent.setup();
    await user.click(await within(main()).findByRole('button', { name: 'Check-out' }));
    await user.click(within(main()).getByRole('button', { name: 'Nahi' }));
    expect(within(main()).getByRole('button', { name: 'Check-out' })).toBeInTheDocument();
    expect(s.calls.some((c) => c.key.includes('check-out'))).toBe(false);
  });

  it('check-out conflict shows server message', async () => {
    const s = server({
      'POST /visits/in1/check-out': () => json(409, { error: 'NOT_CHECKED_IN', message: 'Yeh visitor andar nahi hai.' }),
    });
    renderApp('/desk/inside', s);
    const user = userEvent.setup();
    await user.click(await within(main()).findByRole('button', { name: 'Check-out' }));
    await user.click(within(main()).getByRole('button', { name: 'Haan, check-out karein' }));
    expect(await within(main()).findByRole('alert')).toHaveTextContent('Yeh visitor andar nahi hai.');
  });

  it('check-in only for registered visitors', async () => {
    const s = server({ 'POST /visits/ex1/check-in': () => json(200, { result: 'CHECKED_IN' }) });
    renderApp('/desk/expected', s);
    await within(main()).findByText('Visitor ex2');
    expect(within(main()).getAllByRole('button', { name: 'Check-in' })).toHaveLength(1);
    await userEvent.setup().click(within(main()).getByRole('button', { name: 'Check-in' }));
    await waitFor(() => expect(s.calls.some((c) => c.key === 'POST /visits/ex1/check-in')).toBe(true));
  });

  it('reception can approve from pending list', async () => {
    const s = server({
      'GET /dashboard/live': () => json(200, { ...dashboard, needsCall: [] }),
      'POST /visits/pe1/approve': () => json(200, { id: 'pe1', status: 'APPROVED' }),
    });
    renderApp('/desk/pending', s);
    await userEvent.setup().click(await within(main()).findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(s.calls.some((c) => c.key === 'POST /visits/pe1/approve')).toBe(true));
  });

  it('security sees lists but no action buttons', async () => {
    signIn(USERS.security);
    renderApp('/desk/inside', server());
    await within(main()).findByText('Visitor in1');
    expect(within(main()).queryByRole('button')).toBeNull();
  });

  it('search filters by name or code', async () => {
    const twoInside = {
      ...dashboard,
      inside: [visit('in1', { status: 'CHECKED_IN' }), visit('in2', { status: 'CHECKED_IN' })],
    };
    renderApp('/desk/inside', server({ 'GET /dashboard/live': () => json(200, twoInside) }));
    const user = userEvent.setup();
    await within(main()).findByText('Visitor in1');
    await user.type(screen.getByLabelText('Naam ya code se dhoondein'), 'in2');
    expect(within(main()).getByText('Visitor in2')).toBeInTheDocument();
    expect(within(main()).queryByText('Visitor in1')).not.toBeInTheDocument();
  });

  it('several gates: chooses one and remembers it', async () => {
    const s = server({
      'GET /gates': () =>
        json(200, [
          { id: 'g1', name: 'Main Gate 1', siteId: 's1' },
          { id: 'g2', name: 'Gate 2', siteId: 's1' },
        ]),
    });
    const { unmount } = renderApp('/desk/inside', s);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Aapka gate'), 'g2');
    unmount();
    renderApp('/desk/inside', s);
    expect(await screen.findByLabelText('Aapka gate')).toHaveValue('g2');
  });
});
