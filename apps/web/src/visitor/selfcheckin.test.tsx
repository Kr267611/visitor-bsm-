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

/** Fills the whole form; the OTP comes after it. */
async function fillForm(user: User, about = 'Interview for the weaving master post') {
  await user.type(await screen.findByLabelText('Your name'), 'Rahul Verma');
  await user.type(screen.getByLabelText('Mobile number'), '9876543210');
  await user.type(screen.getByLabelText('Company or firm'), 'ABC Traders');
  await user.selectOptions(screen.getByLabelText('Purpose of visit'), 'Interview');
  await user.type(screen.getByLabelText('About your visit'), about);
  await user.upload(screen.getByLabelText('Your photo'), new File(['raw'], 'me.jpg', { type: 'image/jpeg' }));
  await user.click(screen.getByRole('checkbox', { name: /I agree/ }));
}

async function fillAndVerify(user: User) {
  await fillForm(user);
  await user.click(screen.getByRole('button', { name: 'Send OTP' }));
  await user.type(await screen.findByLabelText('OTP'), '123456');
  await user.click(screen.getByRole('button', { name: 'Verify and send request' }));
}

describe('QR self check-in page', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('form first, then OTP, then the request goes to the desk', async () => {
    const s = server();
    renderApp('/p/acme/head-office', s);
    const user = userEvent.setup();
    expect(await screen.findByText('Acme Pvt Ltd · Head Office')).toBeInTheDocument();

    // The form is the first screen; nothing is sent until it is complete.
    expect(screen.queryByLabelText('OTP')).toBeNull();
    expect(screen.queryByLabelText('Department')).toBeNull();
    const sendOtp = screen.getByRole('button', { name: 'Send OTP' });
    expect(sendOtp).toBeDisabled();
    await fillForm(user);
    expect(s.calls.some((c) => c.key === `POST ${BASE}/otp`)).toBe(false);
    await user.click(sendOtp);

    expect(s.calls.find((c) => c.key === `POST ${BASE}/otp`)!.body).toEqual({ phone: '+919876543210' });
    await user.type(await screen.findByLabelText('OTP'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and send request' }));

    expect(await screen.findByText(/Waiting for approval/)).toBeInTheDocument();
    const body = s.calls.find((c) => c.key === `POST ${BASE}/check-in`)!;
    expect(body.body).toEqual({
      name: 'Rahul Verma',
      company: 'ABC Traders',
      purpose: 'Interview',
      purposeNote: 'Interview for the weaving master post',
      photoKey: 'self/p/s/x.jpg',
      consent: true,
    });
    expect((body.init.headers as Record<string, string>)['x-checkin-session']).toBe('sess-1');
  });

  it('the purpose is a category from the premises list plus the visitor’s own words', async () => {
    renderApp('/p/acme/head-office', server());
    const user = userEvent.setup();
    const category = await screen.findByLabelText('Purpose of visit');
    expect(within(category).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose the purpose', 'Meeting', 'Interview']);
    await fillForm(user);
    await user.clear(screen.getByLabelText('About your visit'));
    expect(screen.getByRole('button', { name: 'Send OTP' })).toBeDisabled();
    await user.type(screen.getByLabelText('About your visit'), 'Meet the weaving master');
    await user.selectOptions(category, '');
    expect(screen.getByRole('button', { name: 'Send OTP' })).toBeDisabled();
    await user.selectOptions(category, 'Meeting');
    expect(screen.getByRole('button', { name: 'Send OTP' })).toBeEnabled();
  });

  it('a wrong number is caught before any OTP is sent', async () => {
    const s = server();
    renderApp('/p/acme/head-office', s);
    const user = userEvent.setup();
    await fillForm(user);
    await user.clear(screen.getByLabelText('Mobile number'));
    await user.type(screen.getByLabelText('Mobile number'), '12345');
    await user.click(screen.getByRole('button', { name: 'Send OTP' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('valid 10-digit');
    expect(s.calls.some((c) => c.key === `POST ${BASE}/otp`)).toBe(false);
  });

  it('a failed request after OTP can be fixed and sent again without a new OTP', async () => {
    let fail = true;
    const s = server({
      [`POST ${BASE}/check-in`]: () =>
        fail
          ? json(422, { error: 'VALIDATION_FAILED', message: 'Please write the purpose of your visit.' })
          : json(201, { status: 'PENDING_APPROVAL', token: 'tok-9', existing: false }),
    });
    renderApp('/p/acme/head-office', s);
    const user = userEvent.setup();
    await fillAndVerify(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('purpose');
    await user.click(screen.getByRole('button', { name: 'Edit my details' }));
    expect(screen.getByLabelText('Your name')).toHaveValue('Rahul Verma');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText(/Waiting for approval/)).toBeInTheDocument();
    expect(s.calls.filter((c) => c.key === `POST ${BASE}/verify`)).toHaveLength(1);
    expect(s.calls.filter((c) => c.key === `POST ${BASE}/photo`)).toHaveLength(1);
  });

  it('a visitor already inside can check out', async () => {
    const s = server({
      [`POST ${BASE}/verify`]: () => json(200, session({ activeVisit: { status: 'CHECKED_IN', token: 'tok-9' } })),
      [`POST ${BASE}/check-out`]: () => json(200, { status: 'CHECKED_OUT' }),
    });
    renderApp('/p/acme/head-office', s);
    const user = userEvent.setup();
    await fillAndVerify(user);
    expect(await screen.findByRole('heading', { name: 'You are checked in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show my pass' })).toHaveAttribute('href', '/v/tok-9');
    await user.click(screen.getByRole('button', { name: 'Check out' }));
    expect(await screen.findByRole('heading', { name: 'You are checked out' })).toBeInTheDocument();
  });

  it('an open visit goes straight to its status page', async () => {
    renderApp('/p/acme/head-office', server({ [`POST ${BASE}/verify`]: () => json(200, session({ activeVisit: { status: 'PENDING_APPROVAL', token: 'tok-9' } })) }));
    await fillAndVerify(userEvent.setup());
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
    await fillAndVerify(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('allow location access');
    expect(s.calls.some((c) => c.key === `POST ${BASE}/verify`)).toBe(false);
    allow = true;
    await user.type(screen.getByLabelText('OTP'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and send request' }));
    await screen.findByText(/Waiting for approval/);
    expect(s.calls.find((c) => c.key === `POST ${BASE}/verify`)!.body.location).toEqual({ lat: 21.17, lng: 72.83, accuracy: 20 });
  });

  it('outside the premises: clear message from the server', async () => {
    renderApp(
      '/p/acme/head-office',
      server({ [`POST ${BASE}/verify`]: () => json(403, { error: 'OUTSIDE_PREMISES', message: 'You need to be at the premises to check in.' }) }),
    );
    await fillAndVerify(userEvent.setup());
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
