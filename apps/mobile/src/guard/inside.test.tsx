import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { fakeServer, Handlers, json, renderScreen, signIn, USERS } from '../../test/harness';
import { InsideList } from './InsideList';

type Listener = (payload?: unknown) => void;
const mockSocket = {
  listeners: new Map<string, Listener>(),
  on(event: string, fn: Listener) {
    this.listeners.set(event, fn);
    return this;
  },
  disconnect: () => undefined,
  fire(event: string, payload?: unknown) {
    this.listeners.get(event)?.(payload);
  },
};
jest.mock('socket.io-client', () => ({ io: () => mockSocket }));

const visit = (id: string, over: object = {}) => ({
  id,
  code: `VIS-${id}`,
  status: 'CHECKED_IN',
  visitorName: `Visitor ${id}`,
  company: null,
  photoUrl: 'http://api.test/photos/x',
  hostName: 'Anita Singh',
  validFrom: '2026-11-05T04:30:00.000Z',
  validTo: '2026-11-05T07:30:00.000Z',
  checkedInAt: '2026-11-05T05:00:00.000Z',
  ...over,
});
const board = (over: object = {}) => ({
  inside: [visit('a'), visit('b')],
  expected: [visit('e', { status: 'APPROVED', checkedInAt: null }), visit('n', { status: 'INVITED', checkedInAt: null })],
  pending: [],
  needsCall: [],
  ...over,
});

function server(over: Handlers = {}) {
  return fakeServer({
    'GET /gates': () => json(200, [{ id: 'g1', name: 'Main Gate 1', siteId: 's1' }]),
    'GET /dashboard/live': () => json(200, board()),
    ...over,
  });
}

describe('inside list', () => {
  beforeEach(async () => {
    mockSocket.listeners.clear();
    await signIn(USERS.guard);
  });

  it('lists inside visitors with photo and host', async () => {
    await renderScreen(<InsideList />, server());
    expect(await screen.findByText('Visitor a')).toBeTruthy();
    expect(screen.getAllByText(/Anita Singh/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Photo of Visitor a').props.source).toEqual({ uri: 'http://api.test/photos/x' });
  });

  it('search filters by name', async () => {
    await renderScreen(<InsideList />, server());
    await screen.findByText('Visitor a');
    await fireEvent.changeText(screen.getByLabelText('Search by name'), 'visitor b');
    expect(screen.queryByText('Visitor a')).toBeNull();
    expect(screen.getByText('Visitor b')).toBeTruthy();
  });

  it('manual check-out notes items carried, removes the row and shows the gate pass number', async () => {
    const s = server({ 'POST /visits/a/check-out': () => json(200, { result: 'CHECKED_OUT', gatePassNo: 'GP-2026-00007' }) });
    await renderScreen(<InsideList />, s);
    await fireEvent.press(await screen.findByRole('button', { name: 'Visitor a check-out' }));
    expect(s.calls.some((c) => c.key === 'POST /visits/a/check-out')).toBe(false);
    await fireEvent.changeText(screen.getByLabelText('Items carried out (optional)'), '2 sample cones');
    s.handlers['GET /dashboard/live'] = () => json(200, board({ inside: [visit('b')] }));
    await fireEvent.press(screen.getByRole('button', { name: 'Yes, check out' }));
    expect(await screen.findByText('Visitor a checked out. Gate pass GP-2026-00007')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Visitor a check-out' })).toBeNull());
    const body = s.calls.find((c) => c.key === 'POST /visits/a/check-out')!.body;
    expect(body.gateId).toBe('g1');
    expect(body.itemsOut).toBe('2 sample cones');
  });

  it('check-out conflict shows message and refreshes', async () => {
    const s = server({
      'POST /visits/a/check-out': () => json(409, { error: 'NOT_CHECKED_IN', message: 'This visitor is not checked in.' }),
    });
    await renderScreen(<InsideList />, s);
    await fireEvent.press(await screen.findByRole('button', { name: 'Visitor a check-out' }));
    const before = s.calls.filter((c) => c.key === 'GET /dashboard/live').length;
    await fireEvent.press(screen.getByRole('button', { name: 'Yes, check out' }));
    expect(await screen.findByText('This visitor is not checked in.')).toBeTruthy();
    await waitFor(() => expect(s.calls.filter((c) => c.key === 'GET /dashboard/live').length).toBeGreaterThan(before));
  });

  it('list refreshes on visit.updated', async () => {
    const s = server();
    await renderScreen(<InsideList />, s);
    await screen.findByText('Visitor a');
    s.handlers['GET /dashboard/live'] = () => json(200, board({ inside: [visit('z')] }));
    await act(async () => mockSocket.fire('visit.updated', { visitId: 'z', status: 'CHECKED_IN' }));
    expect(await screen.findByText('Visitor z')).toBeTruthy();
  });

  it('expected list offers check-in without QR only for approved', async () => {
    const s = server({ 'POST /visits/e/check-in': () => json(200, { result: 'CHECKED_IN' }) });
    await renderScreen(<InsideList />, s);
    await fireEvent.press(await screen.findByRole('button', { name: 'Visitor e check-in' }));
    await waitFor(() => expect(s.calls.some((c) => c.key === 'POST /visits/e/check-in')).toBe(true));
    expect(screen.queryByRole('button', { name: 'Visitor n check-in' })).toBeNull();
  });

  it('load failure shows the message', async () => {
    await renderScreen(<InsideList />, server({ 'GET /dashboard/live': () => json(500, { error: 'INTERNAL', message: 'The server ran into a problem.' }) }));
    expect(await screen.findByText('The server ran into a problem.')).toBeTruthy();
  });
});
