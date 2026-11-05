import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as Notifications from 'expo-notifications';
import { fakeServer, json, renderScreen, signIn, USERS } from '../../test/harness';
import { registerPush } from '../notifications/registerPush';
import { useAuth } from './AuthProvider';
import { homeRouteFor } from './homeRoute';
import { LoginScreen } from './LoginScreen';
import { secureTokens } from './secureTokens';

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
}));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-constants', () => ({ expoConfig: { extra: { eas: { projectId: 'proj' } } } }));

const { __router: router } = jest.requireMock('expo-router');

const session = (role: keyof typeof USERS) => ({
  accessToken: 'a',
  refreshToken: 'r',
  deviceId: 'd',
  user: USERS[role],
});

function WhoAmI() {
  const { user, ready } = useAuth();
  return <Text>{ready ? (user ? `user:${user.role}` : 'logged-out') : 'loading'}</Text>;
}

async function login() {
  await fireEvent.changeText(await screen.findByLabelText('Mobile number'), '9876543210');
  await fireEvent.press(screen.getByRole('button', { name: 'OTP bhejein' }));
  await fireEvent.changeText(await screen.findByLabelText('OTP'), '123456');
  await fireEvent.press(screen.getByRole('button', { name: 'Login karein' }));
}

describe('login', () => {
  it.each([
    ['guard', '/(guard)'],
    ['reception', '/(guard)'],
    ['employee', '/(host)'],
    ['admin', '/use-web'],
    ['security', '/use-web'],
  ] as const)('%s goes to %s', (role, route) => {
    expect(homeRouteFor(role)).toBe(route);
  });

  it('OTP login routes guard to guard home', async () => {
    const server = fakeServer({
      'POST /auth/otp/request': () => json(204),
      'POST /auth/otp/verify': () => json(200, session('guard')),
    });
    await renderScreen(<LoginScreen />, server);
    await login();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/(guard)'));
  });

  it('employee goes to host home', async () => {
    const server = fakeServer({
      'POST /auth/otp/request': () => json(204),
      'POST /auth/otp/verify': () => json(200, session('employee')),
    });
    await renderScreen(<LoginScreen />, server);
    await login();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/(host)'));
  });

  it('admin sees use-web message', async () => {
    const server = fakeServer({
      'POST /auth/otp/request': () => json(204),
      'POST /auth/otp/verify': () => json(200, session('admin')),
    });
    await renderScreen(<LoginScreen />, server);
    await login();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/use-web'));
  });

  it('wrong OTP shows message, stays on OTP step', async () => {
    const server = fakeServer({
      'POST /auth/otp/request': () => json(204),
      'POST /auth/otp/verify': () => json(401, { error: 'INVALID_OTP', message: 'OTP sahi nahi hai.' }),
    });
    await renderScreen(<LoginScreen />, server);
    await login();
    expect(await screen.findByText('OTP sahi nahi hai.')).toBeTruthy();
    expect(screen.getByLabelText('OTP')).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('invalid phone blocked before calling server', async () => {
    const server = fakeServer();
    await renderScreen(<LoginScreen />, server);
    await fireEvent.changeText(await screen.findByLabelText('Mobile number'), '123');
    await fireEvent.press(screen.getByRole('button', { name: 'OTP bhejein' }));
    expect(await screen.findByText(/Mobile number sahi nahi hai/)).toBeTruthy();
    expect(server.calls).toHaveLength(0);
  });

  it('tokens persist across app restart', async () => {
    await signIn(USERS.guard);
    await renderScreen(<WhoAmI />, fakeServer());
    expect(await screen.findByText('user:guard')).toBeTruthy();
    expect((await secureTokens.get())?.accessToken).toBe('token-1');
  });

  it('no saved session means logged out', async () => {
    await renderScreen(<WhoAmI />, fakeServer());
    expect(await screen.findByText('logged-out')).toBeTruthy();
  });

  it('revoked device: next request returns to login, tokens cleared', async () => {
    await signIn(USERS.guard);
    const unauthorized = () => json(401, { error: 'UNAUTHORIZED', message: 'Dobara login karein.' });
    const server = fakeServer({ 'GET /gates': unauthorized, 'POST /auth/refresh': unauthorized });
    await renderScreen(<WhoAmI />, server);
    await screen.findByText('user:guard');
    await expect(server.mobile.client.gates.list()).rejects.toBeTruthy();
    expect(await screen.findByText('logged-out')).toBeTruthy();
    expect(await secureTokens.get()).toBeNull();
  });
});

describe('registerPush', () => {
  const mocks = Notifications as jest.Mocked<typeof Notifications>;
  beforeEach(() => jest.clearAllMocks());

  it('saves the token when allowed', async () => {
    mocks.getPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
    mocks.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[x]' } as never);
    const server = fakeServer({ 'POST /devices/push-token': () => json(204) });
    await registerPush(server.mobile.client);
    expect(server.calls[0].body).toEqual({ pushToken: 'ExponentPushToken[x]' });
  });

  it('push permission denied does not block login', async () => {
    mocks.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' } as never);
    mocks.requestPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);
    const server = fakeServer();
    await expect(registerPush(server.mobile.client)).resolves.toBeUndefined();
    expect(server.calls).toHaveLength(0);
  });

  it('push failure never throws', async () => {
    mocks.getPermissionsAsync.mockRejectedValue(new Error('no play services'));
    await expect(registerPush(fakeServer().mobile.client)).resolves.toBeUndefined();
  });
});
