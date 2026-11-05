import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { fakeServer, Handlers, json, renderScreen, signIn, USERS } from '../../test/harness';
import { routeForNotification } from '../notifications/handleTap';
import { HostHomeScreen } from './HostHomeScreen';
import { InviteScreen } from './InviteScreen';
import { SettingsScreen } from './SettingsScreen';
import { VisitScreen } from './VisitScreen';

const { __router: router } = jest.requireMock('expo-router');

const summary = (over: object = {}) => ({
  id: 'v1',
  code: 'VIS-2026-00001',
  status: 'INVITED',
  visitorName: 'Rahul Verma',
  company: 'ACME',
  photoUrl: null,
  hostName: 'Anita Singh',
  validFrom: '2026-11-05T04:30:00.000Z',
  validTo: '2026-11-05T07:30:00.000Z',
  checkedInAt: null,
  ...over,
});
const detail = (over: object = {}) => ({
  ...summary(),
  purpose: 'Meeting',
  hostId: 'u-emp',
  type: 'PRE',
  decisionNote: null,
  receptionCallRequestedAt: null,
  ...over,
});
const pending = (over: object = {}) => detail({ status: 'PENDING_APPROVAL', type: 'WALKIN', ...over });

function server(over: Handlers = {}) {
  return fakeServer({
    'GET /visits': () => json(200, [summary()]),
    'GET /visits/v1': () => json(200, detail()),
    'GET /me': () => json(200, { id: 'u-emp', delegateId: null, delegateName: null }),
    ...over,
  });
}

describe('routeForNotification', () => {
  it.each(['APPROVAL_REQUEST', 'APPROVAL_REMINDER', 'VISITOR_ARRIVED'])('%s opens the visit', (template) => {
    expect(routeForNotification({ visitId: 'v1', template })).toBe('/(host)/visits/v1');
  });
  it.each([[{}], [{ visitId: '', template: 'VISITOR_ARRIVED' }], [undefined]])('unknown %j returns home', (data) => {
    expect(routeForNotification(data as never)).toBe('/(host)');
  });
  it('odd visit id cannot change the route', () => {
    expect(routeForNotification({ visitId: '../../login', template: 'VISITOR_ARRIVED' })).toBe('/(host)');
  });
});

describe('host screens', () => {
  beforeEach(async () => {
    await signIn(USERS.employee);
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'v1' });
  });

  it('home lists visitors and opens one', async () => {
    await renderScreen(<HostHomeScreen />, server());
    await fireEvent.press(await screen.findByRole('button', { name: /Rahul Verma/ }));
    expect(router.push).toHaveBeenCalledWith('/(host)/visits/v1');
  });

  it('home with nothing explains next step', async () => {
    await renderScreen(<HostHomeScreen />, server({ 'GET /visits': () => json(200, []) }));
    expect(await screen.findByText(/Abhi koi visitor nahi hai/)).toBeTruthy();
  });

  it('approve from visit screen updates status', async () => {
    const s = server({
      'GET /visits/v1': () => json(200, pending()),
      'POST /visits/v1/approve': () => {
        s.handlers['GET /visits/v1'] = () => json(200, pending({ status: 'APPROVED' }));
        return json(200, { id: 'v1', status: 'APPROVED' });
      },
    });
    await renderScreen(<VisitScreen />, s);
    await fireEvent.changeText(await screen.findByLabelText('Guard ke liye note'), '10 minute baithao');
    await fireEvent.press(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('APPROVED')).toBeTruthy();
    expect(s.calls.find((c) => c.key === 'POST /visits/v1/approve')!.body).toEqual({ note: '10 minute baithao' });
  });

  it('reject sends reason', async () => {
    const s = server({
      'GET /visits/v1': () => json(200, pending()),
      'POST /visits/v1/reject': () => json(200, { id: 'v1', status: 'REJECTED' }),
    });
    await renderScreen(<VisitScreen />, s);
    await fireEvent.changeText(await screen.findByLabelText('Guard ke liye note'), 'Aaj nahi');
    await fireEvent.press(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(s.calls.find((c) => c.key === 'POST /visits/v1/reject')?.body).toEqual({ reason: 'Aaj nahi' }));
  });

  it('already decided shows status, no buttons', async () => {
    await renderScreen(<VisitScreen />, server({ 'GET /visits/v1': () => json(200, pending({ status: 'REJECTED', decisionNote: 'Aaj nahi' })) }));
    expect(await screen.findByText('REJECTED')).toBeTruthy();
    expect(screen.getByText(/Aaj nahi/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('second approver conflict shows current status from server', async () => {
    const s = server({
      'GET /visits/v1': () => json(200, pending()),
      'POST /visits/v1/approve': () => {
        s.handlers['GET /visits/v1'] = () => json(200, pending({ status: 'REJECTED' }));
        return json(409, { error: 'INVALID_TRANSITION', message: 'Yeh visit abhi REJECTED hai, yeh kaam nahi ho sakta.', status: 'REJECTED' });
      },
    });
    await renderScreen(<VisitScreen />, s);
    await fireEvent.press(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/abhi REJECTED hai/)).toBeTruthy();
    expect(await screen.findByText('REJECTED')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull());
  });

  it('failed SMS is shown to the host', async () => {
    await renderScreen(<VisitScreen />, server({ 'GET /visits/v1': () => json(200, detail({ deliveryFailed: true })) }));
    expect(await screen.findByText(/SMS nahi pahunch paya/)).toBeTruthy();
  });

  it('visit not allowed shows message', async () => {
    await renderScreen(<VisitScreen />, server({ 'GET /visits/v1': () => json(403, { error: 'FORBIDDEN', message: 'Aapko iski permission nahi hai.' }) }));
    expect(await screen.findByText('Aapko iski permission nahi hai.')).toBeTruthy();
  });

  it('cancel and resend work for open visits', async () => {
    const s = server({
      'POST /visits/v1/resend-invite': () => json(204),
      'POST /visits/v1/cancel': () => json(200, { id: 'v1', status: 'CANCELLED' }),
    });
    await renderScreen(<VisitScreen />, s);
    await fireEvent.press(await screen.findByRole('button', { name: 'Link dobara bhejein' }));
    expect(await screen.findByText(/Naya link bhej diya/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Visit cancel karein' }));
    expect(s.calls.some((c) => c.key === 'POST /visits/v1/cancel')).toBe(false);
    await fireEvent.press(screen.getByRole('button', { name: 'Haan, cancel karein' }));
    await waitFor(() => expect(s.calls.some((c) => c.key === 'POST /visits/v1/cancel')).toBe(true));
  });

  describe('invite', () => {
    async function fill(over: { phone?: string; start?: string; end?: string; date?: string } = {}) {
      await fireEvent.changeText(await screen.findByLabelText('Visitor ka naam'), 'Rahul Verma');
      await fireEvent.changeText(screen.getByLabelText('Visitor ka mobile'), over.phone ?? '98765 43210');
      await fireEvent.changeText(screen.getByLabelText('Date (YYYY-MM-DD)'), over.date ?? '2026-11-06');
      await fireEvent.changeText(screen.getByLabelText('Kab se (HH:MM)'), over.start ?? '10:00');
      await fireEvent.changeText(screen.getByLabelText('Kab tak (HH:MM)'), over.end ?? '13:00');
      await fireEvent.changeText(screen.getByLabelText('Kaam'), 'Meeting');
      await fireEvent.press(screen.getByRole('button', { name: 'Invite bhejein' }));
    }

    it('invite validates phone and time', async () => {
      const s = server();
      await renderScreen(<InviteScreen />, s);
      await fill({ phone: '123' });
      expect(await screen.findByText(/Mobile number sahi nahi hai/)).toBeTruthy();
      await fill({ start: '13:00', end: '10:00' });
      expect(await screen.findByText(/Kab tak ka time/)).toBeTruthy();
      await fill({ start: '25:00' });
      expect(await screen.findByText(/Time HH:MM/)).toBeTruthy();
      await fill({ date: '06-11-2026' });
      expect(await screen.findByText(/Date YYYY-MM-DD/)).toBeTruthy();
      expect(s.calls.some((c) => c.key === 'POST /visits')).toBe(false);
    });

    it('sends IST times, then goes back', async () => {
      const s = server({ 'POST /visits': () => json(201, { id: 'v2', code: 'c', status: 'INVITED' }) });
      await renderScreen(<InviteScreen />, s);
      await fill();
      await waitFor(() => expect(router.back).toHaveBeenCalled());
      expect(s.calls.find((c) => c.key === 'POST /visits')!.body).toEqual({
        visitorName: 'Rahul Verma',
        visitorPhone: '98765 43210',
        validFrom: '2026-11-06T10:00:00+05:30',
        validTo: '2026-11-06T13:00:00+05:30',
        purpose: 'Meeting',
      });
    });
  });

  describe('settings', () => {
    it('delegate can be set from settings', async () => {
      const s = server({
        'GET /users/hosts': () => json(200, [{ id: 'u2', name: 'Ravi Kumar', department: null }]),
        'PATCH /me': ({ body }) => json(200, { delegateId: body.delegateId, delegateName: body.delegateId ? 'Ravi Kumar' : null }),
      });
      await renderScreen(<SettingsScreen />, s);
      await fireEvent.changeText(await screen.findByLabelText('Backup person dhoondein'), 'ravi');
      await fireEvent.press(await screen.findByRole('button', { name: 'Ravi Kumar' }));
      expect(await screen.findByText(/Abhi backup: Ravi Kumar/)).toBeTruthy();
      expect(s.calls.find((c) => c.key === 'PATCH /me')!.body).toEqual({ delegateId: 'u2' });
    });

    it('logout is available', async () => {
      const s = server({ 'POST /auth/logout': () => json(204) });
      await renderScreen(<SettingsScreen />, s);
      await fireEvent.press(await screen.findByRole('button', { name: 'Logout' }));
      await waitFor(() => expect(s.calls.some((c) => c.key === 'POST /auth/logout')).toBe(true));
    });
  });
});
