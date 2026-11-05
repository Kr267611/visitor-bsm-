import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import { fakeServer, Handlers, json, renderScreen, signIn, USERS } from '../../test/harness';
import { GuardHomeScreen } from './GuardHomeScreen';

const mockCamera: { props: any; permission: any; request: jest.Mock; get: jest.Mock } = {
  props: null,
  permission: { granted: true, canAskAgain: true },
  request: jest.fn(),
  get: jest.fn(),
};

jest.mock('expo-camera', () => ({
  CameraView: (props: unknown) => {
    mockCamera.props = props;
    return null;
  },
  useCameraPermissions: () => [mockCamera.permission, mockCamera.request, mockCamera.get],
}));

const { __router: router } = jest.requireMock('expo-router');

const ok = {
  result: 'CHECKED_IN',
  visitId: 'v1',
  visitor: { name: 'Rahul Verma', company: 'ACME', photoUrl: 'http://api.test/photos/t' },
  host: 'Anita Singh',
  validTo: '2026-11-05T07:30:00.000Z',
};

function server(over: Handlers = {}) {
  return fakeServer({
    'GET /gates': () => json(200, [{ id: 'g1', name: 'Main Gate 1', siteId: 's1' }]),
    'POST /gate/scan': () => json(200, ok),
    ...over,
  });
}

const scanCalls = (s: ReturnType<typeof fakeServer>) => s.calls.filter((c) => c.key === 'POST /gate/scan');
const readQr = (data: string) => act(async () => mockCamera.props.onBarcodeScanned({ data }));

describe('guard scan', () => {
  beforeEach(async () => {
    mockCamera.props = null;
    mockCamera.permission = { granted: true, canAskAgain: true };
    await signIn(USERS.guard);
  });

  async function open(s = server()) {
    await renderScreen(<GuardHomeScreen />, s);
    await waitFor(() => expect(mockCamera.props).not.toBeNull());
    await screen.findByText(/Main Gate 1/);
    return s;
  }

  it('scanner reads only QR codes', async () => {
    await open();
    expect(mockCamera.props.barcodeScannerSettings).toEqual({ barcodeTypes: ['qr'] });
  });

  it('success shows photo, name, host', async () => {
    await open();
    await readQr('v1.qr');
    expect(await screen.findByText('Rahul Verma')).toBeTruthy();
    expect(screen.getByText(/Anita Singh/)).toBeTruthy();
    expect(screen.getByLabelText('Visitor ki photo').props.source).toEqual({ uri: 'http://api.test/photos/t' });
    expect(screen.getByText('Andar ja sakte hain')).toBeTruthy();
  });

  it('sends gate, IN mode and an event id', async () => {
    const s = await open();
    await readQr('v1.qr');
    await screen.findByText('Rahul Verma');
    expect(scanCalls(s)[0].body).toMatchObject({ qr: 'v1.qr', gateId: 'g1', mode: 'IN' });
    expect(scanCalls(s)[0].body.clientEventId.length).toBeGreaterThanOrEqual(8);
  });

  it('mode OUT sends mode OUT', async () => {
    const s = await open(server({ 'POST /gate/scan': () => json(200, { ...ok, result: 'CHECKED_OUT' }) }));
    await fireEvent.press(screen.getByRole('button', { name: 'Bahar' }));
    await readQr('v1.qr');
    expect(await screen.findByText('Bahar ja sakte hain')).toBeTruthy();
    expect(scanCalls(s)[0].body.mode).toBe('OUT');
  });

  it('same QR read many times in a second sends one request', async () => {
    const s = await open();
    await act(async () => {
      for (let i = 0; i < 5; i++) mockCamera.props.onBarcodeScanned({ data: 'v1.qr' });
    });
    await screen.findByText('Rahul Verma');
    expect(scanCalls(s)).toHaveLength(1);
  });

  it('scanning stops while the result is on screen', async () => {
    const s = await open();
    await readQr('v1.qr');
    await screen.findByText('Rahul Verma');
    expect(mockCamera.props.onBarcodeScanned ?? null).toBeNull();
    expect(scanCalls(s)).toHaveLength(1);
  });

  it('next scan button returns to scanner', async () => {
    await open();
    await readQr('v1.qr');
    await fireEvent.press(await screen.findByRole('button', { name: 'Agla scan' }));
    expect(screen.queryByText('Rahul Verma')).toBeNull();
    expect(mockCamera.props.onBarcodeScanned).toBeTruthy();
  });

  it('ALREADY_CHECKED_IN shows time and gate', async () => {
    await open(
      server({
        'POST /gate/scan': () =>
          json(409, {
            error: 'ALREADY_CHECKED_IN',
            message: 'Yeh visitor pehle hi Main Gate 1 se andar ja chuke hain.',
            at: '2026-11-05T05:12:00.000Z',
            gate: 'Main Gate 1',
          }),
      }),
    );
    await readQr('v1.qr');
    expect(await screen.findByText(/pehle hi Main Gate 1/)).toBeTruthy();
    expect(screen.getByText(/10:42 am/i)).toBeTruthy();
  });

  it('PASS_EXPIRED shows server message and walk-in button', async () => {
    await open(server({ 'POST /gate/scan': () => json(422, { error: 'PASS_EXPIRED', message: 'Yeh pass 4 Nov ke liye tha' }) }));
    await readQr('v1.qr');
    expect(await screen.findByText('Yeh pass 4 Nov ke liye tha')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Walk-in entry karein' }));
    expect(router.push).toHaveBeenCalledWith('/(guard)/walk-in');
  });

  it('network result shows clear message, not success', async () => {
    await open(
      server({
        'POST /gate/scan': () => {
          throw new TypeError('offline');
        },
      }),
    );
    await readQr('v1.qr');
    // Do retry ke baad hi yeh message aata hai.
    expect(await screen.findByText('Entry confirm nahi hui. Dobara scan karein.', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByText('Andar ja sakte hain')).toBeNull();
  }, 15_000);

  it('rescan after a network failure reuses the event id', async () => {
    const s = await open(
      server({
        'POST /gate/scan': () => {
          throw new TypeError('offline');
        },
      }),
    );
    await readQr('v1.qr');
    await fireEvent.press(await screen.findByRole('button', { name: 'Agla scan' }, { timeout: 5000 }));
    s.handlers['POST /gate/scan'] = () => json(200, ok);
    await readQr('v1.qr');
    await screen.findByText('Rahul Verma');
    const ids = scanCalls(s).map((c) => c.body.clientEventId);
    expect(new Set(ids).size).toBe(1);
  }, 15_000);

  it('after a definite answer the next scan gets a new id', async () => {
    const s = await open();
    await readQr('v1.qr');
    await fireEvent.press(await screen.findByRole('button', { name: 'Agla scan' }));
    await readQr('v1.qr');
    await waitFor(() => expect(scanCalls(s)).toHaveLength(2));
    expect(scanCalls(s)[0].body.clientEventId).not.toBe(scanCalls(s)[1].body.clientEventId);
  });

  it('guard can log out from the main screen', async () => {
    const s = await open(server({ 'POST /auth/logout': () => json(204) }));
    await fireEvent.press(screen.getByRole('button', { name: 'Logout' }));
    await waitFor(() => expect(s.calls.some((c) => c.key === 'POST /auth/logout')).toBe(true));
  });

  it('gate can be changed from the main screen', async () => {
    const s = server({
      'GET /gates': () =>
        json(200, [
          { id: 'g1', name: 'Main Gate 1', siteId: 's1' },
          { id: 'g2', name: 'Gate 2', siteId: 's1' },
        ]),
    });
    await renderScreen(<GuardHomeScreen />, s);
    await fireEvent.press(await screen.findByRole('button', { name: 'Gate 2' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Gate badlein' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Main Gate 1' }));
    await waitFor(() => expect(mockCamera.props).not.toBeNull());
    await readQr('v1.qr');
    await screen.findByText('Rahul Verma');
    expect(scanCalls(s)[0].body.gateId).toBe('g1');
  });

  it('returning from Settings re-checks camera permission', async () => {
    const listeners: ((state: string) => void)[] = [];
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, fn: (s: string) => void) => {
      listeners.push(fn);
      return { remove: () => undefined };
    }) as never);
    mockCamera.permission = { granted: false, canAskAgain: false };
    mockCamera.get.mockClear();
    await renderScreen(<GuardHomeScreen />, server());
    await screen.findByText(/Camera ki permission nahi hai/);
    await act(async () => listeners.forEach((fn) => fn('active')));
    expect(mockCamera.get).toHaveBeenCalled();
    // jest-expo ka AppState pehle se mock hai: restore karne par woh undefined lautata hai.
    spy.mockImplementation((() => ({ remove: () => undefined })) as never);
  });

  it('camera denied shows settings link and manual check-in', async () => {
    mockCamera.permission = { granted: false, canAskAgain: false };
    await renderScreen(<GuardHomeScreen />, server());
    expect(await screen.findByText(/Camera ki permission nahi hai/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Settings kholein' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Bina QR check-in' }));
    expect(router.push).toHaveBeenCalledWith('/(guard)/inside');
  });

  it('camera not asked yet: asks for permission', async () => {
    mockCamera.permission = { granted: false, canAskAgain: true };
    await renderScreen(<GuardHomeScreen />, server());
    await fireEvent.press(await screen.findByRole('button', { name: 'Camera chalu karein' }));
    expect(mockCamera.request).toHaveBeenCalled();
  });

  it('several gates: must choose, choice is remembered', async () => {
    const s = server({
      'GET /gates': () =>
        json(200, [
          { id: 'g1', name: 'Main Gate 1', siteId: 's1' },
          { id: 'g2', name: 'Gate 2', siteId: 's1' },
        ]),
    });
    await renderScreen(<GuardHomeScreen />, s);
    await fireEvent.press(await screen.findByRole('button', { name: 'Gate 2' }));
    await waitFor(() => expect(mockCamera.props).not.toBeNull());
    await readQr('v1.qr');
    await screen.findByText('Rahul Verma');
    expect(scanCalls(s)[0].body.gateId).toBe('g2');
    expect(await SecureStore.getItemAsync('visitor.gate')).toBe('g2');
  });

  it('no gates loaded yet: no scan is possible', async () => {
    await renderScreen(<GuardHomeScreen />, server({ 'GET /gates': () => json(200, []) }));
    expect(await screen.findByText(/Koi gate nahi mila/)).toBeTruthy();
    expect(mockCamera.props).toBeNull();
  });
});
