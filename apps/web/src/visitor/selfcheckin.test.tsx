import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeServer, Handlers, json, renderApp, signIn, USERS } from '../test/harness';

vi.mock('./compressPhoto', async (original) => {
  const real = await original<typeof import('./compressPhoto')>();
  return { ...real, compressPhoto: vi.fn(async () => new Blob(['small-jpeg'], { type: 'image/jpeg' })) };
});

const BASE = '/public/premises/acme/head-office';
const info = (over: object = {}) => ({
  businessName: 'Acme Pvt Ltd',
  premisesName: 'Head Office',
  purposes: ['Meeting', 'Interview'],
  needsLocation: false,
  status: 'open',
  visitStart: null,
  visitEnd: null,
  ...over,
});
const session = (over: object = {}) => ({ sessionToken: 'sess-1', visitor: null, activeVisit: null, ...over });

function server(over: Handlers = {}) {
  return fakeServer({
    [`GET ${BASE}`]: () => json(200, info()),
    [`POST ${BASE}/otp`]: () => json(204),
    [`POST ${BASE}/verify`]: () => json(200, session()),
    [`GET ${BASE}/hosts`]: () =>
      json(200, [
        { id: 'h1', name: 'Anita Singh', department: 'Finance', designation: 'Manager' },
        { id: 'h2', name: 'Rakesh Patel', department: 'Weaving', designation: 'Master' },
        { id: 'h3', name: 'Suresh Yadav', department: 'Weaving', designation: 'Supervisor' },
      ]),
    [`POST ${BASE}/photo`]: () => json(201, { key: 'self/p/s/x.jpg' }),
    [`POST ${BASE}/check-in`]: () => json(201, { status: 'PENDING_APPROVAL', token: 'tok-9', existing: false }),
    'GET /public/invites/tok-9': () =>
      json(200, {
        status: 'PENDING_APPROVAL',
        visitorName: 'Rahul Verma',
        hostName: 'Anita Singh',
        siteName: 'Head Office',
        validFrom: '2026-11-18T04:30:00.000Z',
        validTo: '2026-11-18T08:30:00.000Z',
        pass: null,
      }),
    ...over,
  });
}

type User = ReturnType<typeof userEvent.setup>;

async function verifyPhone(user: User) {
  await user.type(await screen.findByLabelText('Mobile number'), '9876543210');
  await user.click(screen.getByRole('button', { name: 'Send OTP' }));
  await user.type(await screen.findByLabelText('OTP'), '123456');
  await user.click(screen.getByRole('button', { name: 'Verify' }));
}

describe('QR self check-in page', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('new visitor: OTP, writes the purpose, photo, consent, then the waiting screen', async () => {
    const s = server();
    renderApp('/p/acme/head-office', s);
    const user = userEvent.setup();
    expect(await screen.findByText('Acme Pvt Ltd · Head Office')).toBeInTheDocument();
    await verifyPhone(user);

    await user.type(await screen.findByLabelText('Your name'), 'Rahul Verma');
    await user.type(screen.getByLabelText('Company or firm'), 'ABC Traders');
    // No department or person list: the visitor writes the purpose, and the request goes to the desk.
    expect(screen.queryByLabelText('Department')).toBeNull();
    const submit = screen.getByRole('button', { name: 'Send request' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('Purpose of visit'), 'Interview for the weaving master post');
    await user.upload(screen.getByLabelText('Your photo'), new File(['raw'], 'me.jpg', { type: 'image/jpeg' }));
    await user.click(screen.getByRole('checkbox', { name: /I agree/ }));
    await user.click(submit);

    expect(await screen.findByText(/Waiting for approval/)).toBeInTheDocument();
    const body = s.calls.find((c) => c.key === `POST ${BASE}/check-in`)!;
    expect(body.body).toEqual({
      name: 'Rahul Verma',
      company: 'ABC Traders',
      purpose: 'Interview for the weaving master post',
      photoKey: 'self/p/s/x.jpg',
      consent: true,
    });
    expect((body.init.headers as Record<string, string>)['x-checkin-session']).toBe('sess-1');
  });

  it('returning visitor is greeted, prefilled and does not need a new photo', async () => {
    const s = server({
      [`POST ${BASE}/verify`]: () => json(200, session({ visitor: { name: 'Rahul Verma', company: 'ACME', hasPhoto: true } })),
    });
    renderApp('/p/acme/head-office', s);
    const user = userEvent.setup();
    await verifyPhone(user);
    expect(await screen.findByRole('heading', { name: 'Welcome back, Rahul Verma' })).toBeInTheDocument();
    expect(screen.getByLabelText('Company or firm')).toHaveValue('ACME');
    expect(screen.getByLabelText('New photo (optional)')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Purpose of visit'), 'Payment follow-up with accounts');
    await user.click(screen.getByRole('checkbox', { name: /I agree/ }));
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByText(/Waiting for approval/);
    expect(s.calls.some((c) => c.key === `POST ${BASE}/photo`)).toBe(false);
  });

  it('a visitor already inside can check out', async () => {
    const s = server({
      [`POST ${BASE}/verify`]: () => json(200, session({ activeVisit: { status: 'CHECKED_IN', token: 'tok-9' } })),
      [`POST ${BASE}/check-out`]: () => json(200, { status: 'CHECKED_OUT' }),
    });
    renderApp('/p/acme/head-office', s);
    const user = userEvent.setup();
    await verifyPhone(user);
    expect(await screen.findByRole('heading', { name: 'You are checked in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show my pass' })).toHaveAttribute('href', '/v/tok-9');
    await user.click(screen.getByRole('button', { name: 'Check out' }));
    expect(await screen.findByRole('heading', { name: 'You are checked out' })).toBeInTheDocument();
  });

  it('an open visit goes straight to its status page', async () => {
    renderApp('/p/acme/head-office', server({ [`POST ${BASE}/verify`]: () => json(200, session({ activeVisit: { status: 'PENDING_APPROVAL', token: 'tok-9' } })) }));
    await verifyPhone(userEvent.setup());
    expect(await screen.findByText(/Waiting for approval/)).toBeInTheDocument();
  });

  it('geofenced premises sends the browser location; denied location shows how to fix it', async () => {
    let allow = true;
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: {
        getCurrentPosition: (ok: PositionCallback, fail: PositionErrorCallback) =>
          allow
            ? ok({ coords: { latitude: 21.17, longitude: 72.83, accuracy: 20 } } as GeolocationPosition)
            : fail({ code: 1 } as GeolocationPositionError),
      },
    });
    const s = server({ [`GET ${BASE}`]: () => json(200, info({ needsLocation: true })) });
    renderApp('/p/acme/head-office', s);
    const user = userEvent.setup();
    allow = false;
    await verifyPhone(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('allow location access');
    expect(s.calls.some((c) => c.key === `POST ${BASE}/verify`)).toBe(false);
    allow = true;
    await user.type(screen.getByLabelText('OTP'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await screen.findByLabelText('Your name');
    expect(s.calls.find((c) => c.key === `POST ${BASE}/verify`)!.body.location).toEqual({ lat: 21.17, lng: 72.83, accuracy: 20 });
  });

  it('outside the premises: clear message from the server', async () => {
    renderApp(
      '/p/acme/head-office',
      server({ [`POST ${BASE}/verify`]: () => json(403, { error: 'OUTSIDE_PREMISES', message: 'You need to be at the premises to check in.' }) }),
    );
    await verifyPhone(userEvent.setup());
    expect(await screen.findByRole('alert')).toHaveTextContent('You need to be at the premises');
    expect(screen.getByLabelText('OTP')).toHaveValue('');
  });

  it('closed and unavailable premises say so without asking for a number', async () => {
    const closed = server({ [`GET ${BASE}`]: () => json(200, info({ status: 'closed', visitStart: '09:00', visitEnd: '18:00' })) });
    const { unmount } = renderApp('/p/acme/head-office', closed);
    expect(await screen.findByRole('heading', { name: 'Closed for visitors' })).toBeInTheDocument();
    expect(screen.getByText(/09:00 to 18:00/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Mobile number')).toBeNull();
    unmount();
    renderApp('/p/acme/head-office', server({ [`GET ${BASE}`]: () => json(200, info({ status: 'unavailable' })) }));
    expect(await screen.findByRole('heading', { name: 'Currently unavailable' })).toBeInTheDocument();
  });

  it('unknown poster link says so', async () => {
    renderApp('/p/acme/nope', fakeServer());
    expect(await screen.findByRole('heading', { name: 'This check-in link is not valid' })).toBeInTheDocument();
  });

  it('waiting screen refreshes until the host decides', async () => {
    let status = 'PENDING_APPROVAL';
    const s = server({
      'GET /public/invites/tok-9': () =>
        json(200, {
          status,
          visitorName: 'Rahul Verma',
          hostName: 'Anita Singh',
          siteName: 'Head Office',
          validFrom: '2026-11-18T04:30:00.000Z',
          validTo: '2026-11-18T08:30:00.000Z',
          pass: status === 'APPROVED' ? 'v1.payload.sig' : null,
        }),
    });
    renderApp('/v/tok-9', s);
    await screen.findByText(/Waiting for approval/);
    status = 'APPROVED';
    await waitFor(() => expect(screen.getByRole('img', { name: 'Visitor pass QR code' })).toBeInTheDocument(), { timeout: 6000 });
  }, 10_000);
});

describe('premises QR poster', () => {
  it('admin opens a printable poster pointing at the check-in page', async () => {
    signIn(USERS.admin);
    renderApp(
      '/admin/premises/p1/poster',
      fakeServer({
        'GET /me': () => json(200, { business: { id: 'b1', name: 'Acme Pvt Ltd', slug: 'acme' } }),
        'GET /admin/premises': () => json(200, [{ id: 'p1', name: 'Head Office', webSlug: 'head-office', code: 'ABC234', isDefault: true }]),
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Visitor check-in' })).toBeInTheDocument();
    expect(screen.getByText(`${window.location.origin}/p/acme/head-office`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print poster' })).toBeInTheDocument();
  });

  it('premises list links to the poster', async () => {
    signIn(USERS.admin);
    renderApp(
      '/admin/premises',
      fakeServer({
        'GET /me': () => json(200, { delegateId: null }),
        'GET /admin/premises': () => json(200, [{ id: 'p1', name: 'Head Office', webSlug: 'head-office', code: 'ABC234', isDefault: true }]),
        'GET /admin/gates': () => json(200, []),
      }),
    );
    expect(await screen.findByRole('link', { name: 'QR poster' })).toHaveAttribute('href', '/admin/premises/p1/poster');
  });
});
