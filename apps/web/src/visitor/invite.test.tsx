import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeServer, json, renderApp } from '../test/harness';

vi.mock('./compressPhoto', async (original) => {
  const real = await original<typeof import('./compressPhoto')>();
  return {
    ...real,
    compressPhoto: vi.fn(async () => new Blob(['small-jpeg'], { type: 'image/jpeg' })),
  };
});

import { compressPhoto, PhotoError } from './compressPhoto';

const invite = (over: object = {}) => ({
  status: 'INVITED',
  visitorName: 'Rahul Verma',
  hostName: 'Anita Singh',
  siteName: 'Main Site',
  validFrom: '2026-11-05T04:30:00.000Z',
  validTo: '2026-11-05T07:30:00.000Z',
  pass: null,
  ...over,
});

const PASS = 'v1.payload.signature';

const statusCases: [string, RegExp][] = [
  ['CHECKED_OUT', /Aapki visit poori ho gayi/],
  ['CANCELLED', /Yeh visit cancel ho gayi hai/],
  ['EXPIRED', /Is link ka time khatam ho gaya hai/],
  ['REJECTED', /Yeh visit approve nahi hui/],
  ['PENDING_APPROVAL', /Host ke jawab ka intezaar/],
];

function server(over: object = {}) {
  return fakeServer({
    'GET /public/invites/tok': () => json(200, invite()),
    'POST /public/invites/tok/photo': () => json(201, { key: 'visitors/v1/p.jpg' }),
    'POST /public/invites/tok/register': () => json(201, invite({ status: 'APPROVED', pass: PASS })),
    ...over,
  });
}

async function fillForm(user: ReturnType<typeof userEvent.setup>, opts: { consent?: boolean } = {}) {
  const file = new File(['raw'], 'me.jpg', { type: 'image/jpeg' });
  await user.upload(await screen.findByLabelText('Aapki photo'), file);
  if (opts.consent !== false) {
    await user.click(screen.getByRole('checkbox', { name: /sahmat/i }));
  }
}

describe('visitor invite page', () => {
  beforeEach(() => {
    vi.mocked(compressPhoto).mockClear();
    vi.mocked(compressPhoto).mockResolvedValue(new Blob(['small-jpeg'], { type: 'image/jpeg' }));
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
  });

  it('INVITED shows form with name filled, no login needed', async () => {
    renderApp('/v/tok', server());
    expect(await screen.findByLabelText('Aapka naam')).toHaveValue('Rahul Verma');
    expect(screen.getByText(/Anita Singh/)).toBeInTheDocument();
  });

  it.each(statusCases)('status %s shows correct screen', async (status, text) => {
    renderApp('/v/tok', server({ 'GET /public/invites/tok': () => json(200, invite({ status })) }));
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByLabelText('Aapka naam')).not.toBeInTheDocument();
    expect(document.querySelector('svg')).toBeNull();
  });

  it('APPROVED shows QR, host, site, time', async () => {
    renderApp('/v/tok', server({ 'GET /public/invites/tok': () => json(200, invite({ status: 'APPROVED', pass: PASS })) }));
    expect(await screen.findByText('Rahul Verma')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Visitor pass ka QR code' })).toBeInTheDocument();
    expect(screen.getByText('Anita Singh')).toBeInTheDocument();
    expect(screen.getByText('Main Site')).toBeInTheDocument();
    expect(screen.getByText(/10:00 am/i)).toBeInTheDocument();
  });

  it('CHECKED_IN shows QR and exit instruction', async () => {
    renderApp('/v/tok', server({ 'GET /public/invites/tok': () => json(200, invite({ status: 'CHECKED_IN', pass: PASS })) }));
    expect(await screen.findByText(/Jaate waqt yeh QR gate par dikhayein/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Visitor pass ka QR code' })).toBeInTheDocument();
  });

  it('unknown link shows message', async () => {
    renderApp('/v/tok', server({ 'GET /public/invites/tok': () => json(404, { error: 'NOT_FOUND', message: 'x' }) }));
    expect(await screen.findByText(/Yeh link sahi nahi hai/)).toBeInTheDocument();
  });

  it('network failure offers retry that works', async () => {
    const s = server({
      'GET /public/invites/tok': () => {
        throw new TypeError('offline');
      },
    });
    renderApp('/v/tok', s);
    const retry = await screen.findByRole('button', { name: 'Dobara koshish karein' });
    s.handlers['GET /public/invites/tok'] = () => json(200, invite());
    await userEvent.setup().click(retry);
    expect(await screen.findByLabelText('Aapka naam')).toBeInTheDocument();
  });

  it('submit blocked until consent and photo present', async () => {
    renderApp('/v/tok', server());
    const user = userEvent.setup();
    await screen.findByLabelText('Aapka naam');
    const submit = screen.getByRole('button', { name: 'Pass banayein' });
    expect(submit).toBeDisabled();
    await fillForm(user, { consent: false });
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /sahmat/i }));
    expect(submit).toBeEnabled();
  });

  it('consent is not ticked by default and links privacy page', async () => {
    renderApp('/v/tok', server());
    expect(await screen.findByRole('checkbox', { name: /sahmat/i })).not.toBeChecked();
    expect(screen.getByRole('link', { name: 'Privacy notice' })).toHaveAttribute('href', '/privacy');
  });

  it('idLast4 accepts only 4 digits', async () => {
    renderApp('/v/tok', server());
    const user = userEvent.setup();
    const field = await screen.findByLabelText(/ID ke aakhri 4 digit/);
    await user.type(field, '12ab34567');
    expect(field).toHaveValue('1234');
  });

  it('there is no full ID number field', async () => {
    renderApp('/v/tok', server());
    await screen.findByLabelText('Aapka naam');
    expect(screen.queryByLabelText(/aadhaar number/i)).not.toBeInTheDocument();
  });

  it('button disabled during submit: double click sends one request', async () => {
    let release = () => {};
    const s = server({
      'POST /public/invites/tok/register': () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(json(201, invite({ status: 'APPROVED', pass: PASS })));
        }),
    });
    renderApp('/v/tok', s);
    const user = userEvent.setup();
    await fillForm(user);
    const submit = screen.getByRole('button', { name: 'Pass banayein' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(s.calls.filter((c) => c.key.endsWith('/register'))).toHaveLength(1));
    expect(screen.getByRole('button', { name: /Ho raha hai/ })).toBeDisabled();
    release();
    await screen.findByRole('img', { name: 'Visitor pass ka QR code' });
    expect(s.calls.filter((c) => c.key.endsWith('/register'))).toHaveLength(1);
  });

  it('failed submit shows error and keeps entered values', async () => {
    const s = server({
      'POST /public/invites/tok/register': () => json(500, { error: 'INTERNAL', message: 'Server mein dikkat hai.' }),
    });
    renderApp('/v/tok', s);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Company'), 'ACME');
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Pass banayein' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Server mein dikkat hai.');
    expect(screen.getByLabelText('Company')).toHaveValue('ACME');
    s.handlers['POST /public/invites/tok/register'] = () => json(201, invite({ status: 'APPROVED', pass: PASS }));
    await user.click(screen.getByRole('button', { name: 'Pass banayein' }));
    await screen.findByRole('img', { name: 'Visitor pass ka QR code' });
    expect(s.calls.filter((c) => c.key.endsWith('/photo'))).toHaveLength(1);
  });

  it('success shows QR without page reload, sends consent and details', async () => {
    const s = server();
    renderApp('/v/tok', s);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Company'), 'ACME');
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Pass banayein' }));
    await screen.findByRole('img', { name: 'Visitor pass ka QR code' });
    const body = s.calls.find((c) => c.key.endsWith('/register'))!.body;
    expect(body).toMatchObject({ name: 'Rahul Verma', company: 'ACME', photoKey: 'visitors/v1/p.jpg', consent: true });
    expect(s.calls.filter((c) => c.key === 'GET /public/invites/tok')).toHaveLength(1);
  });

  it('selected photo goes through compression before upload', async () => {
    const s = server();
    renderApp('/v/tok', s);
    const user = userEvent.setup();
    await fillForm(user);
    expect(compressPhoto).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Pass banayein' }));
    await screen.findByRole('img', { name: 'Visitor pass ka QR code' });
    const form = s.calls.find((c) => c.key.endsWith('/photo'))!.body as FormData;
    const sent = form.get('photo') as Blob;
    expect(sent.size).toBe('small-jpeg'.length);
  });

  it('photo that cannot be read shows message, button stays off', async () => {
    vi.mocked(compressPhoto).mockRejectedValue(new PhotoError('Yeh photo nahi chal rahi. Camera se nayi photo lein.'));
    renderApp('/v/tok', server());
    const user = userEvent.setup();
    await fillForm(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Yeh photo nahi chal rahi');
    expect(screen.getByRole('button', { name: 'Pass banayein' })).toBeDisabled();
  });

  it('privacy page is public', async () => {
    renderApp('/privacy', fakeServer());
    expect(await screen.findByRole('heading', { name: 'Privacy notice' })).toBeInTheDocument();
    expect(screen.getByText(/180 din/)).toBeInTheDocument();
  });
});
