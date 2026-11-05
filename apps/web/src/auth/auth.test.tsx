import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeServer, json, renderApp, signIn, USERS } from '../test/harness';

const session = (role: keyof typeof USERS) => ({
  accessToken: 'a',
  refreshToken: 'r',
  deviceId: 'd',
  user: USERS[role],
});

async function login(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Mobile number'), '9876543210');
  await user.click(screen.getByRole('button', { name: 'OTP bhejein' }));
  await user.type(await screen.findByLabelText('OTP'), '123456');
  await user.click(screen.getByRole('button', { name: 'Login karein' }));
}

describe('login', () => {
  it('OTP login redirects by role', async () => {
    const server = fakeServer({
      'POST /auth/otp/request': () => json(204),
      'POST /auth/otp/verify': () => json(200, session('reception')),
      'GET /dashboard/live': () => json(200, { inside: [], expected: [], pending: [], needsCall: [] }),
      'GET /gates': () => json(200, []),
    });
    renderApp('/login', server);
    await login(userEvent.setup());
    expect(await screen.findByRole('heading', { name: 'Reception desk' })).toBeInTheDocument();
  });

  it('employee lands on own visits', async () => {
    const server = fakeServer({
      'POST /auth/otp/request': () => json(204),
      'POST /auth/otp/verify': () => json(200, session('employee')),
      'GET /visits': () => json(200, []),
      'GET /me': () => json(200, { delegateId: null }),
    });
    renderApp('/login', server);
    await login(userEvent.setup());
    expect(await screen.findByRole('heading', { name: 'Mere visitors' })).toBeInTheDocument();
  });

  it('wrong OTP shows message, keeps phone', async () => {
    const server = fakeServer({
      'POST /auth/otp/request': () => json(204),
      'POST /auth/otp/verify': () => json(401, { error: 'INVALID_OTP', message: 'OTP sahi nahi hai.' }),
    });
    renderApp('/login', server);
    await login(userEvent.setup());
    expect(await screen.findByRole('alert')).toHaveTextContent('OTP sahi nahi hai.');
    expect(screen.getByText(/9876543210/)).toBeInTheDocument();
    expect(screen.getByLabelText('OTP')).toHaveValue('');
  });

  it('rate limit shows wait message', async () => {
    const server = fakeServer({
      'POST /auth/otp/request': () =>
        json(429, { error: 'OTP_RATE_LIMITED', message: 'Bahut baar OTP maanga gaya. 10 minute baad koshish karein.' }),
    });
    renderApp('/login', server);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Mobile number'), '9876543210');
    await user.click(screen.getByRole('button', { name: 'OTP bhejein' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('10 minute baad');
    expect(screen.queryByLabelText('OTP')).not.toBeInTheDocument();
  });

  it('invalid phone blocked before calling server', async () => {
    const server = fakeServer();
    renderApp('/login', server);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Mobile number'), '123');
    await user.click(screen.getByRole('button', { name: 'OTP bhejein' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mobile number sahi nahi hai');
    expect(server.calls).toHaveLength(0);
  });

  it('server down shows connection message', async () => {
    const server = fakeServer({
      'POST /auth/otp/request': () => {
        throw new TypeError('offline');
      },
    });
    renderApp('/login', server);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Mobile number'), '9876543210');
    await user.click(screen.getByRole('button', { name: 'OTP bhejein' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('connection');
  });

  it('RequireRole shows no-access for wrong role', async () => {
    signIn(USERS.employee);
    renderApp('/admin/users', fakeServer());
    expect(await screen.findByText('Is page ki permission aapko nahi hai.')).toBeInTheDocument();
  });

  it('logged out user goes to login', async () => {
    renderApp('/desk', fakeServer());
    expect(await screen.findByLabelText('Mobile number')).toBeInTheDocument();
  });

  it('session expiry goes to /login?next=<page> and returns after login', async () => {
    signIn(USERS.employee);
    const server = fakeServer({
      'GET /visits': () => json(401, { error: 'UNAUTHORIZED', message: 'Dobara login karein.' }),
      'GET /me': () => json(401, { error: 'UNAUTHORIZED', message: 'Dobara login karein.' }),
      'POST /auth/refresh': () => json(401, { error: 'UNAUTHORIZED', message: 'Dobara login karein.' }),
      'POST /auth/otp/request': () => json(204),
      'POST /auth/otp/verify': () => json(200, session('employee')),
    });
    renderApp('/my', server);
    const phone = await screen.findByLabelText('Mobile number');
    expect(phone).toBeInTheDocument();
    server.handlers['GET /visits'] = () => json(200, []);
    server.handlers['GET /me'] = () => json(200, { delegateId: null });
    await login(userEvent.setup());
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Mere visitors' })).toBeInTheDocument());
  });

  it('logout returns to login', async () => {
    signIn(USERS.employee);
    const server = fakeServer({
      'GET /visits': () => json(200, []),
      'GET /me': () => json(200, { delegateId: null }),
      'POST /auth/logout': () => json(204),
    });
    renderApp('/my', server);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Logout' }));
    expect(await screen.findByLabelText('Mobile number')).toBeInTheDocument();
    expect(localStorage.getItem('visitor.tokens')).toBeNull();
  });
});
