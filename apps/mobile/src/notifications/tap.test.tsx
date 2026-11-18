import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import * as Notifications from 'expo-notifications';
import { Text } from 'react-native';
import { fakeServer, renderScreen, signIn, USERS } from '../../test/harness';
import { useNotificationRouting } from './handleTap';

jest.mock('expo-notifications', () => ({ useLastNotificationResponse: jest.fn() }));

const { __router: router } = jest.requireMock('expo-router');
const mockResponse = Notifications.useLastNotificationResponse as jest.Mock;

const tapped = (id = 'n1') => ({
  notification: {
    request: { identifier: id, content: { data: { visitId: 'v1', template: 'APPROVAL_REQUEST' } } },
  },
});

function Probe() {
  useNotificationRouting();
  const [n, setN] = useState(0);
  return <Text onPress={() => setN(n + 1)}>probe {n}</Text>;
}

describe('useNotificationRouting', () => {
  it('cold-start tap opens the visit after auth loads', async () => {
    await signIn(USERS.employee);
    mockResponse.mockReturnValue(tapped());
    await renderScreen(<Probe />, fakeServer());
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/(host)/visits/v1'));
  });

  it('same tap is handled only once across re-renders', async () => {
    await signIn(USERS.employee);
    // A new object on every render, as the real hook may return.
    mockResponse.mockImplementation(() => tapped());
    await renderScreen(<Probe />, fakeServer());
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByText(/probe 0/));
    await screen.findByText(/probe 1/);
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it('logged out: no navigation', async () => {
    mockResponse.mockReturnValue(tapped());
    await renderScreen(<Probe />, fakeServer());
    await screen.findByText(/probe/);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('no tap: no navigation', async () => {
    await signIn(USERS.employee);
    mockResponse.mockReturnValue(null);
    await renderScreen(<Probe />, fakeServer());
    await screen.findByText(/probe/);
    expect(router.push).not.toHaveBeenCalled();
  });
});
