import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { fakeServer, Handlers, json, renderScreen, signIn, USERS } from '../../test/harness';
import { RequestsScreen } from './RequestsScreen';

jest.mock('socket.io-client', () => ({ io: () => ({ on() { return this; }, disconnect: () => undefined }) }));

const request = (id: string, over: object = {}) => ({
  id,
  code: `VIS-${id}`,
  status: 'PENDING_APPROVAL',
  visitorName: `Visitor ${id}`,
  company: 'ABC Traders',
  photoUrl: null,
  hostName: 'Reception desk',
  validFrom: '2026-11-27T04:30:00.000Z',
  validTo: '2026-11-27T08:30:00.000Z',
  checkedInAt: null,
  purpose: 'Raw material supply',
  purposeNote: 'Yarn lot 12',
  ...over,
});

function server(over: Handlers = {}) {
  return fakeServer({
    'GET /dashboard/live': () => json(200, { inside: [], expected: [], pending: [request('a'), request('b')], needsCall: [] }),
    ...over,
  });
}

describe('guard requests', () => {
  beforeEach(async () => {
    await signIn(USERS.guard);
  });

  it('shows each request with its purpose and who they want to meet', async () => {
    await renderScreen(<RequestsScreen />, server());
    expect(await screen.findByText('Visitor a')).toBeTruthy();
    expect(screen.getAllByText('Raw material supply — Yarn lot 12')).toHaveLength(2);
    expect(screen.getAllByText('To meet: Reception desk')).toHaveLength(2);
  });

  it('approve and reject send the decision and refresh the list', async () => {
    const s = server({
      'POST /visits/a/approve': () => json(200, { id: 'a', status: 'APPROVED' }),
      'POST /visits/b/reject': () => json(200, { id: 'b', status: 'REJECTED' }),
    });
    await renderScreen(<RequestsScreen />, s);
    s.handlers['GET /dashboard/live'] = () => json(200, { inside: [], expected: [], pending: [request('b')], needsCall: [] });
    await fireEvent.press(await screen.findByRole('button', { name: 'Approve Visitor a' }));
    await waitFor(() => expect(screen.queryByText('Visitor a')).toBeNull());
    s.handlers['GET /dashboard/live'] = () => json(200, { inside: [], expected: [], pending: [], needsCall: [] });
    await fireEvent.press(screen.getByRole('button', { name: 'Reject Visitor b' }));
    expect(await screen.findByText('No requests waiting.')).toBeTruthy();
    expect(s.calls.map((c) => c.key)).toEqual(expect.arrayContaining(['POST /visits/a/approve', 'POST /visits/b/reject']));
  });

  it('someone else decided first: the message shows and the list refreshes', async () => {
    const s = server({
      'POST /visits/a/approve': () => json(409, { error: 'INVALID_TRANSITION', message: 'This request was already decided.', status: 'APPROVED' }),
    });
    await renderScreen(<RequestsScreen />, s);
    await fireEvent.press(await screen.findByRole('button', { name: 'Approve Visitor a' }));
    expect(await screen.findByText('This request was already decided.')).toBeTruthy();
  });
});
