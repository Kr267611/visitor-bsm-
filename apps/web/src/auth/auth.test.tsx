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

async function otpTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('tab', { name: 'OTP' }));
}

async function login(user: ReturnType<typeof userEvent.setup>) {
  await otpTab(user);
  await user.type(screen.getByLabelText('Mobile number'), '9876543210');
  await user.click(screen.getByRole('button', { name: 'Send OTP' }));
  await user.type(await screen.findByLabelText('OTP'), '123456');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
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
    expect(await screen.findByRole('heading', { level: 1, name: 'Awaiting approval' })).toBeInTheDocument();
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
    expect(await screen.findByRole('heading', { level: 1, name: 'My visitors' })).toBeInTheDocument();
  });

  it('wrong OTP shows message, keeps phone', async () => {
    const server = fakeServer({
      'POST /auth/otp/request': () => json(204),
      'POST /auth/otp/verify': () => json(401, { error: 'INVALID_OTP', message: 'Incorrect OTP.' }),
    });
    renderApp('/login', server);
    await login(userEvent.setup());
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect OTP.');
    expect(screen.getByText(/9876543210/)).toBeInTheDocument();
    expect(screen.getByLabelText('OTP')).toHaveValue('');
  });

  it('rate limit shows wait message', async () => {
    const server = fakeServer({
      'POST /auth/otp/request': () =>
        json(429, { error: 'OTP_RATE_LIMITED', message: 'Too many OTP requests. Please try again in 10 minutes.' }),
    });
    renderApp('/login', server);
    const user = userEvent.setup();
    await otpTab(user);
    await user.type(screen.getByLabelText('Mobile number'), '9876543210');
    await user.click(screen.getByRole('button', { name: 'Send OTP' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('try again in 10 minutes');
    expect(screen.queryByLabelText('OTP')).not.toBeInTheDocument();
  });

  it('invalid phone blocked before calling server', async () => {
    const server = fakeServer();
    renderApp('/login', server);
    const user = userEvent.setup();
    await otpTab(user);
    await user.type(screen.getByLabelText('Mobile number'), '123');
    await user.click(screen.getByRole('button', { name: 'Send OTP' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid 10-digit mobile number');
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
    await otpTab(user);
    await user.type(screen.getByLabelText('Mobile number'), '9876543210');
    await user.click(screen.getByRole('button', { name: 'Send OTP' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('connection');
  });

  it('RequireRole shows no-access for wrong role', async () => {
    signIn(USERS.employee);
    renderApp('/admin/users', fakeServer());
    expect(await screen.findByText(/You do not have access to this page/)).toBeInTheDocument();
  });

  it('logged out user goes to login', async () => {
    renderApp('/desk', fakeServer());
    expect(await screen.findByLabelText('Mobile or email')).toBeInTheDocument();
  });

  it('session expiry goes to /login?next=<page> and returns after login', async () => {
    signIn(USERS.employee);
    const server = fakeServer({
      'GET /visits': () => json(401, { error: 'UNAUTHORIZED', message: 'Please sign in again.' }),
      'GET /me': () => json(401, { error: 'UNAUTHORIZED', message: 'Please sign in again.' }),
      'POST /auth/refresh': () => json(401, { error: 'UNAUTHORIZED', message: 'Please sign in again.' }),
      'POST /auth/otp/request': () => json(204),
      'POST /auth/otp/verify': () => json(200, session('employee')),
    });
    renderApp('/my', server);
    const phone = await screen.findByLabelText('Mobile or email');
    expect(phone).toBeInTheDocument();
    server.handlers['GET /visits'] = () => json(200, []);
    server.handlers['GET /me'] = () => json(200, { delegateId: null });
    await login(userEvent.setup());
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'My visitors' })).toBeInTheDocument());
  });

  it('logout returns to login', async () => {
    signIn(USERS.employee);
    const server = fakeServer({
      'GET /visits': () => json(200, []),
      'GET /me': () => json(200, { delegateId: null }),
      'POST /auth/logout': () => json(204),
    });
    renderApp('/my', server);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Log out' }));
    expect(await screen.findByLabelText('Mobile or email')).toBeInTheDocument();
    expect(localStorage.getItem('visitor.tokens')).toBeNull();
  });

  describe('password and business choice', () => {
    async function passwordLogin(user: ReturnType<typeof userEvent.setup>, password = 'Secret@123') {
      await user.type(await screen.findByLabelText('Mobile or email'), 'asha@acme.test');
      await user.type(screen.getByLabelText('Password'), password);
      await user.click(screen.getByRole('button', { name: 'Sign in' }));
    }

    it('password login is the default and lands by role', async () => {
      const server = fakeServer({
        'POST /auth/login': () => json(200, session('employee')),
        'GET /visits': () => json(200, []),
        'GET /me': () => json(200, { delegateId: null }),
      });
      renderApp('/login', server);
      await passwordLogin(userEvent.setup());
      expect(await screen.findByRole('heading', { level: 1, name: 'My visitors' })).toBeInTheDocument();
      expect(server.calls[0].body).toEqual({ identifier: 'asha@acme.test', password: 'Secret@123', deviceName: 'Web browser' });
    });

    it('wrong password shows message and clears the password', async () => {
      const server = fakeServer({
        'POST /auth/login': () => json(401, { error: 'INVALID_CREDENTIALS', message: 'Incorrect phone/email or password.' }),
      });
      renderApp('/login', server);
      await passwordLogin(userEvent.setup());
      expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect phone/email or password');
      expect(screen.getByLabelText('Password')).toHaveValue('');
      expect(screen.getByLabelText('Mobile or email')).toHaveValue('asha@acme.test');
    });

    it('several businesses: choose one, then signed in to it', async () => {
      const server = fakeServer({
        'POST /auth/login': () =>
          json(409, {
            error: 'CHOOSE_BUSINESS',
            message: 'Which business do you want to sign in to?',
            selectionToken: 'sel-1',
            businesses: [
              { id: 'b1', name: 'Acme Pvt Ltd' },
              { id: 'b2', name: 'Globex' },
            ],
          }),
        'POST /auth/select-business': () => json(200, session('employee')),
        'GET /visits': () => json(200, []),
        'GET /me': () => json(200, { delegateId: null }),
      });
      renderApp('/login', server);
      const user = userEvent.setup();
      await passwordLogin(user);
      expect(await screen.findByRole('heading', { name: 'Choose a business' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Globex' }));
      expect(await screen.findByRole('heading', { level: 1, name: 'My visitors' })).toBeInTheDocument();
      expect(server.calls.find((c) => c.key === 'POST /auth/select-business')!.body).toEqual({
        selectionToken: 'sel-1',
        businessId: 'b2',
        deviceName: 'Web browser',
      });
      expect(localStorage.getItem('visitor.tokens')).toContain('"a"');
    });

    it('expired choice goes back to login with the message', async () => {
      const server = fakeServer({
        'POST /auth/login': () =>
          json(409, { error: 'CHOOSE_BUSINESS', message: 'x', selectionToken: 's', businesses: [{ id: 'b1', name: 'Acme' }] }),
        'POST /auth/select-business': () => json(401, { error: 'UNAUTHORIZED', message: 'Sign-in timed out. Please sign in again.' }),
      });
      renderApp('/login', server);
      const user = userEvent.setup();
      await passwordLogin(user);
      await user.click(await screen.findByRole('button', { name: 'Acme' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('timed out');
      expect(screen.getByLabelText('Mobile or email')).toBeInTheDocument();
    });

    it('OTP can also ask to choose a business', async () => {
      const server = fakeServer({
        'POST /auth/otp/request': () => json(204),
        'POST /auth/otp/verify': () =>
          json(409, { error: 'CHOOSE_BUSINESS', message: 'x', selectionToken: 's', businesses: [{ id: 'b1', name: 'Acme' }] }),
      });
      renderApp('/login', server);
      await login(userEvent.setup());
      expect(await screen.findByRole('button', { name: 'Acme' })).toBeInTheDocument();
    });

    it('new login forgets the premises chosen before', async () => {
      localStorage.setItem('visitor.premises', JSON.stringify('old-premises'));
      const server = fakeServer({
        'POST /auth/login': () => json(200, session('employee')),
        'GET /visits': () => json(200, []),
        'GET /me': () => json(200, { delegateId: null }),
      });
      renderApp('/login', server);
      await passwordLogin(userEvent.setup());
      await screen.findByRole('heading', { level: 1, name: 'My visitors' });
      expect(localStorage.getItem('visitor.premises')).toBeNull();
      const visits = server.calls.find((c) => c.key === 'GET /visits')!;
      expect((visits.init.headers as Record<string, string>)['X-Premises-Id']).toBeUndefined();
    });

    it('change password page', async () => {
      signIn(USERS.employee);
      const server = fakeServer({ 'PUT /me/password': () => json(204), 'GET /me': () => json(200, { delegateId: null }) });
      renderApp('/account/password', server);
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText('New password'), 'NewPass@12');
      await user.type(screen.getByLabelText('Confirm new password'), 'NewPass@13');
      await user.click(screen.getByRole('button', { name: 'Save password' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('do not match');
      await user.clear(screen.getByLabelText('Confirm new password'));
      await user.type(screen.getByLabelText('Confirm new password'), 'NewPass@12');
      await user.click(screen.getByRole('button', { name: 'Save password' }));
      expect(await screen.findByRole('status')).toHaveTextContent('Password saved');
      expect(server.calls.find((c) => c.key === 'PUT /me/password')!.body).toEqual({ newPassword: 'NewPass@12' });
    });

    it('super admin lands on the platform notice', async () => {
      const server = fakeServer({
        'POST /auth/login': () =>
          json(200, { ...session('admin'), user: { id: 'sa', name: 'Platform', role: 'super_admin', businessId: null } }),
      });
      renderApp('/login', server);
      await passwordLogin(userEvent.setup());
      expect(await screen.findByRole('heading', { name: 'Platform admin' })).toBeInTheDocument();
    });
  });
});
