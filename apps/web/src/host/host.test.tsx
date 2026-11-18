import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeServer, Handlers, json, renderApp, signIn, USERS } from '../test/harness';

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

function server(over: Handlers = {}) {
  return fakeServer({
    'GET /visits': () => json(200, [summary()]),
    'GET /me': () => json(200, { id: 'u-emp', delegateId: null, delegateName: null }),
    'GET /visits/v1': () => json(200, detail()),
    ...over,
  });
}

describe('host screens', () => {
  beforeEach(() => signIn(USERS.employee));

  it('lists own visitors with status and a link', async () => {
    renderApp('/my', server());
    expect(await screen.findByRole('link', { name: /Rahul Verma/ })).toHaveAttribute('href', '/my/visits/v1');
    expect(screen.getByText('INVITED')).toBeInTheDocument();
  });

  it('empty list explains the next step', async () => {
    renderApp('/my', server({ 'GET /visits': () => json(200, []) }));
    expect(await screen.findByText(/Abhi koi visitor nahi hai/)).toBeInTheDocument();
  });

  describe('invite form', () => {
    async function fill(user: ReturnType<typeof userEvent.setup>, over: { phone?: string; start?: string; end?: string } = {}) {
      await user.type(await screen.findByLabelText('Visitor ka naam'), 'Rahul Verma');
      await user.type(screen.getByLabelText('Visitor ka mobile'), over.phone ?? '98765 43210');
      await user.clear(screen.getByLabelText('Date'));
      await user.type(screen.getByLabelText('Date'), '2026-11-06');
      await user.clear(screen.getByLabelText('Kab se'));
      await user.type(screen.getByLabelText('Kab se'), over.start ?? '10:00');
      await user.clear(screen.getByLabelText('Kab tak'));
      await user.type(screen.getByLabelText('Kab tak'), over.end ?? '13:00');
      await user.type(screen.getByLabelText('Kaam'), 'Meeting');
    }

    it('invite form validates phone with normalizeIndianPhone', async () => {
      const s = server();
      renderApp('/my/invite', s);
      const user = userEvent.setup();
      await fill(user, { phone: '123' });
      await user.click(screen.getByRole('button', { name: 'Invite bhejein' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Mobile number sahi nahi hai');
      expect(s.calls.some((c) => c.key === 'POST /visits')).toBe(false);
    });

    it('end time before start blocked', async () => {
      const s = server();
      renderApp('/my/invite', s);
      const user = userEvent.setup();
      await fill(user, { start: '13:00', end: '10:00' });
      await user.click(screen.getByRole('button', { name: 'Invite bhejein' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Kab tak ka time');
      expect(s.calls.some((c) => c.key === 'POST /visits')).toBe(false);
    });

    it('invite success sends IST times and shows new visit in list', async () => {
      const s = server({ 'POST /visits': () => json(201, { id: 'v2', code: 'VIS-2026-00002', status: 'INVITED' }) });
      renderApp('/my/invite', s);
      const user = userEvent.setup();
      await fill(user);
      await user.click(screen.getByRole('button', { name: 'Invite bhejein' }));
      await screen.findByRole('heading', { level: 1, name: 'Mere visitors' });
      const body = s.calls.find((c) => c.key === 'POST /visits')!.body;
      expect(body).toEqual({
        visitorName: 'Rahul Verma',
        visitorPhone: '98765 43210',
        validFrom: '2026-11-06T10:00:00+05:30',
        validTo: '2026-11-06T13:00:00+05:30',
        purpose: 'Meeting',
      });
    });

    it('server error keeps the form filled', async () => {
      const s = server({ 'POST /visits': () => json(422, { error: 'VALIDATION_FAILED', message: 'Ek pass 24 ghante se zyada ka nahi ho sakta.' }) });
      renderApp('/my/invite', s);
      const user = userEvent.setup();
      await fill(user);
      await user.click(screen.getByRole('button', { name: 'Invite bhejein' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('24 ghante');
      expect(screen.getByLabelText('Visitor ka naam')).toHaveValue('Rahul Verma');
    });
  });

  describe('approval page', () => {
    const pending = (over: object = {}) => detail({ status: 'PENDING_APPROVAL', type: 'WALKIN', ...over });

    it('approval page approve works with note', async () => {
      const s = server({
        'GET /visits/v1': () => json(200, pending()),
        'POST /visits/v1/approve': () => {
          s.handlers['GET /visits/v1'] = () => json(200, pending({ status: 'APPROVED' }));
          return json(200, { id: 'v1', status: 'APPROVED' });
        },
      });
      renderApp('/my/visits/v1', s);
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText('Guard ke liye note'), '10 minute baithao');
      await user.click(screen.getByRole('button', { name: 'Approve' }));
      expect(await screen.findByText('APPROVED')).toBeInTheDocument();
      expect(s.calls.find((c) => c.key === 'POST /visits/v1/approve')!.body).toEqual({ note: '10 minute baithao' });
    });

    it('reject works with reason', async () => {
      const s = server({
        'GET /visits/v1': () => json(200, pending()),
        'POST /visits/v1/reject': () => json(200, { id: 'v1', status: 'REJECTED' }),
      });
      renderApp('/my/visits/v1', s);
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText('Guard ke liye note'), 'Aaj nahi');
      await user.click(screen.getByRole('button', { name: 'Reject' }));
      await waitFor(() =>
        expect(s.calls.find((c) => c.key === 'POST /visits/v1/reject')?.body).toEqual({ reason: 'Aaj nahi' }),
      );
    });

    it('already decided visit shows the current status, no buttons', async () => {
      renderApp('/my/visits/v1', server({ 'GET /visits/v1': () => json(200, pending({ status: 'REJECTED', decisionNote: 'Aaj nahi' })) }));
      expect(await screen.findByText('REJECTED')).toBeInTheDocument();
      expect(screen.getByText(/Aaj nahi/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    });

    it('someone else decided first: shows the conflict and refreshes', async () => {
      const s = server({
        'GET /visits/v1': () => json(200, pending()),
        'POST /visits/v1/approve': () => {
          s.handlers['GET /visits/v1'] = () => json(200, pending({ status: 'REJECTED' }));
          return json(409, { error: 'INVALID_TRANSITION', message: 'Yeh visit abhi REJECTED hai, yeh kaam nahi ho sakta.', status: 'REJECTED' });
        },
      });
      renderApp('/my/visits/v1', s);
      await userEvent.setup().click(await screen.findByRole('button', { name: 'Approve' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('REJECTED');
      expect(await screen.findByText('REJECTED')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument());
    });

    it('SMS link while logged out returns here after login', async () => {
      localStorage.clear();
      const s = server({
        'GET /visits/v1': () => json(200, pending()),
        'POST /auth/otp/request': () => json(204),
        'POST /auth/otp/verify': () =>
          json(200, { accessToken: 'a', refreshToken: 'r', deviceId: 'd', user: USERS.employee }),
      });
      renderApp('/my/visits/v1', s);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('tab', { name: 'OTP' }));
      await user.type(await screen.findByLabelText('Mobile number'), '9876543210');
      await user.click(screen.getByRole('button', { name: 'OTP bhejein' }));
      await user.type(await screen.findByLabelText('OTP'), '123456');
      await user.click(screen.getByRole('button', { name: 'Login karein' }));
      expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument();
    });

    it('failed SMS is shown to the host', async () => {
      renderApp('/my/visits/v1', server({ 'GET /visits/v1': () => json(200, detail({ deliveryFailed: true })) }));
      expect(await screen.findByText(/SMS nahi pahunch paya/)).toBeInTheDocument();
    });

    it('no permission shows message', async () => {
      renderApp('/my/visits/v1', server({ 'GET /visits/v1': () => json(403, { error: 'FORBIDDEN', message: 'Aapko iski permission nahi hai.' }) }));
      expect(await screen.findByRole('alert')).toHaveTextContent('permission');
    });

    it.each([
      ['INVITED', true],
      ['APPROVED', true],
      ['CHECKED_IN', false],
      ['CHECKED_OUT', false],
    ])('cancel for %s available: %s', async (status, available) => {
      renderApp('/my/visits/v1', server({ 'GET /visits/v1': () => json(200, detail({ status })) }));
      await screen.findByText(status as string);
      expect(screen.queryByRole('button', { name: 'Visit cancel karein' }) !== null).toBe(available);
    });

    it('cancel confirms in page first', async () => {
      const s = server({ 'POST /visits/v1/cancel': () => json(200, { id: 'v1', status: 'CANCELLED' }) });
      renderApp('/my/visits/v1', s);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Visit cancel karein' }));
      expect(s.calls.some((c) => c.key === 'POST /visits/v1/cancel')).toBe(false);
      await user.click(screen.getByRole('button', { name: 'Haan, cancel karein' }));
      await waitFor(() => expect(s.calls.some((c) => c.key === 'POST /visits/v1/cancel')).toBe(true));
    });

    it('resend invite works and says so', async () => {
      const s = server({ 'POST /visits/v1/resend-invite': () => json(204) });
      renderApp('/my/visits/v1', s);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Link dobara bhejein' }));
      expect(await screen.findByText(/Naya link bhej diya/)).toBeInTheDocument();
    });
  });

  describe('delegate', () => {
    it('delegate can be set and cleared', async () => {
      const s = server({
        'GET /users/hosts': () => json(200, [{ id: 'u2', name: 'Ravi Kumar', department: 'Finance' }]),
        'PATCH /me': ({ body }) =>
          json(200, { delegateId: body.delegateId, delegateName: body.delegateId ? 'Ravi Kumar' : null }),
      });
      renderApp('/my/backup', s);
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText('Backup person dhoondein'), 'ravi');
      await user.click(await screen.findByRole('button', { name: /Ravi Kumar/ }));
      expect(await screen.findByText(/Abhi backup: Ravi Kumar/)).toBeInTheDocument();
      expect(s.calls.find((c) => c.key === 'PATCH /me')!.body).toEqual({ delegateId: 'u2' });
      await user.click(screen.getByRole('button', { name: 'Backup hatayein' }));
      await waitFor(() => expect(screen.queryByText(/Abhi backup/)).not.toBeInTheDocument());
    });

    it('does not offer self as backup', async () => {
      const s = server({
        'GET /users/hosts': () => json(200, [{ id: USERS.employee.id, name: 'Anita', department: null }]),
      });
      renderApp('/my/backup', s);
      await userEvent.setup().type(await screen.findByLabelText('Backup person dhoondein'), 'an');
      await waitFor(() => expect(s.calls.some((c) => c.key === 'GET /users/hosts')).toBe(true));
      expect(screen.queryByRole('button', { name: /Anita/ })).not.toBeInTheDocument();
    });
  });
});
