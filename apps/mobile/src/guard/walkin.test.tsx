import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { fakeServer, Handlers, json, renderScreen, signIn, USERS } from '../../test/harness';
import { capturePhoto, compressUntilSmall } from './capturePhoto';
import { WalkInScreen } from './WalkInScreen';

jest.mock('./capturePhoto', () => ({
  ...jest.requireActual('./capturePhoto'),
  capturePhoto: jest.fn(),
}));

type Listener = (payload?: unknown) => void;
const mockSocket = {
  listeners: new Map<string, Listener>(),
  on(event: string, fn: Listener) {
    this.listeners.set(event, fn);
    return this;
  },
  disconnect: () => undefined,
  connect: jest.fn(),
  fire(event: string, payload?: unknown) {
    this.listeners.get(event)?.(payload);
  },
};
jest.mock('socket.io-client', () => ({ io: () => mockSocket }));

const detail = (over: object = {}) => ({
  id: 'v1',
  code: 'VIS-2026-00001',
  status: 'PENDING_APPROVAL',
  visitorName: 'Rahul Verma',
  company: 'ACME',
  photoUrl: null,
  hostName: 'Anita Singh',
  validFrom: '2026-11-05T04:30:00.000Z',
  validTo: '2026-11-05T08:30:00.000Z',
  checkedInAt: null,
  purpose: 'Delivery',
  hostId: 'h1',
  type: 'WALKIN',
  decisionNote: null,
  receptionCallRequestedAt: null,
  ...over,
});

function server(over: Handlers = {}) {
  return fakeServer({
    'GET /gates': () => json(200, [{ id: 'g1', name: 'Main Gate 1', siteId: 's1' }]),
    'GET /gate/visitors/lookup': () => json(200, { found: false }),
    'POST /gate/walk-ins/otp': () => json(204),
    'GET /users/hosts': () => json(200, [{ id: 'h1', name: 'Anita Singh', department: 'Finance' }]),
    'POST /uploads/photo': () => json(201, { key: 'uploads/u/p.jpg' }),
    'POST /gate/walk-ins': () => json(201, { visitId: 'v1', code: 'VIS-2026-00001', status: 'PENDING_APPROVAL' }),
    'GET /visits/v1': () => json(200, detail()),
    ...over,
  });
}

async function startFlow() {
  await fireEvent.changeText(await screen.findByLabelText('Visitor mobile'), '98765 43210');
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByLabelText('OTP');
}

async function fillDetails(opts: { photo?: boolean; consent?: boolean } = {}) {
  await fireEvent.changeText(screen.getByLabelText('OTP'), '123456');
  await fireEvent.changeText(screen.getByLabelText('Name'), 'Rahul Verma');
  await fireEvent.changeText(screen.getByLabelText('Purpose'), 'Delivery');
  if (opts.photo !== false) {
    await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
    await screen.findByLabelText('Captured photo');
  }
  await fireEvent.changeText(screen.getByLabelText('Who are they meeting?'), 'anita');
  await fireEvent.press(await screen.findByRole('button', { name: /Anita Singh/ }));
  if (opts.consent !== false) {
    await fireEvent.press(screen.getByRole('checkbox', { name: /The visitor has been told/ }));
  }
}

const submit = () => fireEvent.press(screen.getByRole('button', { name: 'Send to host' }));

describe('walk-in', () => {
  beforeEach(async () => {
    mockSocket.listeners.clear();
    (capturePhoto as jest.Mock).mockResolvedValue({ uri: 'file://photo.jpg' });
    await signIn(USERS.guard);
  });

  it('known visitor prefilled after lookup, no new photo needed', async () => {
    const s = server({
      'GET /gate/visitors/lookup': () =>
        json(200, { found: true, name: 'Rahul Verma', company: 'ACME', photoUrl: 'http://api.test/photos/old' }),
    });
    await renderScreen(<WalkInScreen />, s);
    await startFlow();
    expect(screen.getByLabelText('Name').props.value).toBe('Rahul Verma');
    expect(screen.getByLabelText('Company').props.value).toBe('ACME');
    await fillDetails({ photo: false });
    await submit();
    await screen.findByText(/Waiting for the host/);
    const body = s.calls.find((c) => c.key === 'POST /gate/walk-ins')!.body;
    expect(body.photoKey).toBeUndefined();
    expect(s.calls.some((c) => c.key === 'POST /uploads/photo')).toBe(false);
  });

  it('invalid phone stopped before any request', async () => {
    const s = server();
    await renderScreen(<WalkInScreen />, s);
    await fireEvent.changeText(await screen.findByLabelText('Visitor mobile'), '123');
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/Enter a valid 10-digit mobile number/)).toBeTruthy();
    expect(s.calls.filter((c) => c.key.includes('walk-ins'))).toHaveLength(0);
  });

  it('new visitor needs name and photo', async () => {
    await renderScreen(<WalkInScreen />, server());
    await startFlow();
    await fillDetails({ photo: false });
    expect(screen.getByRole('button', { name: 'Send to host' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
    await screen.findByLabelText('Captured photo');
    expect(screen.getByRole('button', { name: 'Send to host' })).toBeEnabled();
  });

  it('submit blocked without consent', async () => {
    await renderScreen(<WalkInScreen />, server());
    await startFlow();
    await fillDetails({ consent: false });
    expect(screen.getByRole('button', { name: 'Send to host' })).toBeDisabled();
  });

  it('wrong OTP stays on form with message, nothing lost', async () => {
    const s = server({ 'POST /gate/walk-ins': () => json(401, { error: 'INVALID_OTP', message: 'Incorrect OTP.' }) });
    await renderScreen(<WalkInScreen />, s);
    await startFlow();
    await fillDetails();
    await submit();
    expect(await screen.findByText('Incorrect OTP.')).toBeTruthy();
    expect(screen.getByLabelText('Name').props.value).toBe('Rahul Verma');
    expect(s.calls.filter((c) => c.key === 'POST /uploads/photo')).toHaveLength(1);
    await submit();
    await waitFor(() => expect(s.calls.filter((c) => c.key === 'POST /gate/walk-ins')).toHaveLength(2));
    expect(s.calls.filter((c) => c.key === 'POST /uploads/photo')).toHaveLength(1);
  });

  it('retry after network loss reuses clientEventId', async () => {
    let first = true;
    const s = server({
      'POST /gate/walk-ins': () => {
        if (first) {
          first = false;
          throw new TypeError('offline');
        }
        return json(201, { visitId: 'v1', code: 'c', status: 'PENDING_APPROVAL' });
      },
    });
    await renderScreen(<WalkInScreen />, s);
    await startFlow();
    await fillDetails();
    await submit();
    await screen.findByText(/connection/);
    await submit();
    await screen.findByText(/Waiting for the host/);
    const ids = s.calls.filter((c) => c.key === 'POST /gate/walk-ins').map((c) => c.body.clientEventId);
    expect(ids[0]).toBe(ids[1]);
  });

  async function reachWaiting(s = server()) {
    await renderScreen(<WalkInScreen />, s);
    await startFlow();
    await fillDetails();
    await submit();
    await screen.findByText(/Waiting for the host/);
    return s;
  }

  it('waiting screen shows approved via socket, then Check-in button', async () => {
    const s = await reachWaiting(
      server({ 'POST /visits/v1/check-in': () => json(200, { result: 'CHECKED_IN' }) }),
    );
    await act(async () => mockSocket.fire('ready'));
    s.handlers['GET /visits/v1'] = () => json(200, detail({ status: 'APPROVED', decisionNote: 'Please wait 10 minutes' }));
    await act(async () => mockSocket.fire('visit.updated', { visitId: 'v1', status: 'APPROVED' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Check in' }));
    expect(screen.getByText(/Please wait 10 minutes/)).toBeTruthy();
    expect(await screen.findByText(/Checked in/)).toBeTruthy();
    expect(s.calls.find((c) => c.key === 'POST /visits/v1/check-in')!.body.gateId).toBe('g1');
  });

  it('ready refetches, so an approval during the gap is not missed', async () => {
    const s = await reachWaiting();
    s.handlers['GET /visits/v1'] = () => json(200, detail({ status: 'APPROVED' }));
    await act(async () => mockSocket.fire('ready'));
    expect(await screen.findByRole('button', { name: 'Check in' })).toBeTruthy();
  });

  it('server disconnect (expired token) refreshes session and reconnects', async () => {
    const s = await reachWaiting(server({ 'GET /me': () => json(200, { id: 'u' }) }));
    mockSocket.connect.mockClear();
    await act(async () => mockSocket.fire('disconnect', 'io server disconnect'));
    await waitFor(() => expect(mockSocket.connect).toHaveBeenCalled(), { timeout: 5000 });
    expect(s.calls.some((c) => c.key === 'GET /me')).toBe(true);
  }, 10_000);

  it('ignores updates for other visits', async () => {
    const s = await reachWaiting();
    const before = s.calls.filter((c) => c.key === 'GET /visits/v1').length;
    await act(async () => mockSocket.fire('visit.updated', { visitId: 'other', status: 'APPROVED' }));
    expect(s.calls.filter((c) => c.key === 'GET /visits/v1').length).toBe(before);
  });

  it('polls every 5s when socket down', async () => {
    const s = await reachWaiting();
    s.handlers['GET /visits/v1'] = () => json(200, detail({ status: 'APPROVED' }));
    expect(await screen.findByRole('button', { name: 'Check in' }, { timeout: 7000 })).toBeTruthy();
  }, 15_000);

  it('rejected shows reason, no check-in button', async () => {
    const s = await reachWaiting();
    s.handlers['GET /visits/v1'] = () => json(200, detail({ status: 'REJECTED', decisionNote: 'Not today' }));
    await act(async () => mockSocket.fire('visit.updated', { visitId: 'v1', status: 'REJECTED' }));
    expect(await screen.findByText(/Not today/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check in' })).toBeNull();
  });

  it('after 5 min shows "Reception is calling the host"', async () => {
    const s = await reachWaiting();
    s.handlers['GET /visits/v1'] = () => json(200, detail({ receptionCallRequestedAt: '2026-11-05T05:00:00.000Z' }));
    await act(async () => mockSocket.fire('visit.updated', { visitId: 'v1', status: 'PENDING_APPROVAL' }));
    expect(await screen.findByText(/Reception is calling the host/)).toBeTruthy();
  });

  it('resend OTP disabled for 30s', async () => {
    await renderScreen(<WalkInScreen resendDelayMs={100} />, server());
    await startFlow();
    expect(screen.getByRole('button', { name: /Resend OTP/ })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: /Resend OTP/ })).toBeEnabled());
  });

  it('check-in reuses clientEventId on retry', async () => {
    let first = true;
    const s = await reachWaiting(
      server({
        'POST /visits/v1/check-in': () => {
          if (first) {
            first = false;
            throw new TypeError('offline');
          }
          return json(200, { result: 'CHECKED_IN' });
        },
      }),
    );
    s.handlers['GET /visits/v1'] = () => json(200, detail({ status: 'APPROVED' }));
    await act(async () => mockSocket.fire('visit.updated', { visitId: 'v1', status: 'APPROVED' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Check in' }));
    await screen.findByText(/connection/);
    await fireEvent.press(screen.getByRole('button', { name: 'Check in' }));
    await screen.findByText(/Checked in/);
    const ids = s.calls.filter((c) => c.key === 'POST /visits/v1/check-in').map((c) => c.body.clientEventId);
    expect(ids[0]).toBe(ids[1]);
  });
});

describe('compressUntilSmall', () => {
  it('lowers quality until under 200 KB', async () => {
    const seen: number[] = [];
    const uri = await compressUntilSmall(async (q) => {
      seen.push(q);
      return { uri: `file://${q}`, size: q > 0.5 ? 500_000 : 150_000 };
    }, 200_000);
    expect(uri).toBe(`file://${seen[seen.length - 1]}`);
    expect(seen[0]).toBeGreaterThan(seen[seen.length - 1]);
  });

  it('gives the smallest attempt if nothing fits', async () => {
    const uri = await compressUntilSmall(async (q) => ({ uri: `file://${q}`, size: 900_000 }), 200_000);
    expect(uri).toBe('file://0.35');
  });
});
