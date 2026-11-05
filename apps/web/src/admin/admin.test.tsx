import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeServer, Handlers, json, renderApp, signIn, USERS } from '../test/harness';

const sites = [{ id: 's1', name: 'Main Site', address: 'Surat' }];
const gates = [{ id: 'g1', name: 'Main Gate 1', siteId: 's1', isActive: true }];
const person = (over: object = {}) => ({
  id: 'u1',
  name: 'Amit Guard',
  phone: '+919000000002',
  email: null,
  role: 'guard',
  department: null,
  siteId: 's1',
  isActive: true,
  ...over,
});

function server(over: Handlers = {}) {
  return fakeServer({
    'GET /admin/users': () => json(200, [person()]),
    'GET /admin/sites': () => json(200, sites),
    'GET /admin/gates': () => json(200, gates),
    'GET /admin/devices': () =>
      json(200, [
        {
          id: 'd1',
          name: 'Gate phone',
          lastSeenAt: null,
          revokedAt: null,
          createdAt: '2026-11-05T04:30:00.000Z',
          user: { id: 'u1', name: 'Amit Guard', role: 'guard' },
        },
      ]),
    ...over,
  });
}

describe('admin', () => {
  beforeEach(() => signIn(USERS.admin));

  it('creates user and shows in the list', async () => {
    const s = server({
      'POST /admin/users': () => {
        s.handlers['GET /admin/users'] = () => json(200, [person(), person({ id: 'u2', name: 'Ravi Kumar', role: 'employee' })]);
        return json(201, person({ id: 'u2', name: 'Ravi Kumar', role: 'employee' }));
      },
    });
    renderApp('/admin/users', s);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Naam'), 'Ravi Kumar');
    await user.type(screen.getByLabelText('Mobile'), '9876543210');
    await user.selectOptions(screen.getByLabelText('Role'), 'employee');
    await user.selectOptions(screen.getByLabelText('Site'), 's1');
    await user.click(screen.getByRole('button', { name: 'User banayein' }));
    expect(await screen.findByText('Ravi Kumar')).toBeInTheDocument();
    expect(s.calls.find((c) => c.key === 'POST /admin/users')!.body).toEqual({
      name: 'Ravi Kumar',
      phone: '9876543210',
      role: 'employee',
      siteId: 's1',
    });
    expect(screen.getByLabelText('Naam')).toHaveValue('');
  });

  it('duplicate phone shows server message', async () => {
    renderApp('/admin/users', server({
      'POST /admin/users': () => json(422, { error: 'VALIDATION_FAILED', message: 'Yeh mobile number pehle se hai.' }),
    }));
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Naam'), 'Ravi');
    await user.type(screen.getByLabelText('Mobile'), '9876543210');
    await user.selectOptions(screen.getByLabelText('Site'), 's1');
    await user.click(screen.getByRole('button', { name: 'User banayein' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('pehle se hai');
    expect(screen.getByLabelText('Naam')).toHaveValue('Ravi');
  });

  it('deactivate confirms in page, then marks inactive', async () => {
    const s = server({
      'PATCH /admin/users/u1': () => {
        s.handlers['GET /admin/users'] = () => json(200, [person({ isActive: false })]);
        return json(200, person({ isActive: false }));
      },
    });
    renderApp('/admin/users', s);
    const user = userEvent.setup();
    const row = (await screen.findByText('Amit Guard')).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Band karein' }));
    expect(s.calls.some((c) => c.key === 'PATCH /admin/users/u1')).toBe(false);
    await user.click(within(row).getByRole('button', { name: 'Haan, band karein' }));
    expect(await screen.findByText('Band hai')).toBeInTheDocument();
    expect(s.calls.find((c) => c.key === 'PATCH /admin/users/u1')!.body).toEqual({ isActive: false });
  });

  it('inactive user can be turned back on', async () => {
    const s = server({
      'GET /admin/users': () => json(200, [person({ isActive: false })]),
      'PATCH /admin/users/u1': () => json(200, person()),
    });
    renderApp('/admin/users', s);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Chalu karein' }));
    await waitFor(() =>
      expect(s.calls.find((c) => c.key === 'PATCH /admin/users/u1')?.body).toEqual({ isActive: true }),
    );
  });

  it('adds site and gate', async () => {
    const s = server({
      'POST /admin/sites': () => json(201, { id: 's2', name: 'Plant 2', address: null }),
      'POST /admin/gates': () => json(201, { id: 'g2', name: 'Gate 2', siteId: 's1', isActive: true }),
    });
    renderApp('/admin/sites', s);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Site ka naam'), 'Plant 2');
    await user.click(screen.getByRole('button', { name: 'Site jodein' }));
    await waitFor(() => expect(s.calls.find((c) => c.key === 'POST /admin/sites')?.body).toEqual({ name: 'Plant 2' }));
    await user.selectOptions(screen.getByLabelText('Gate ki site'), 's1');
    await user.type(screen.getByLabelText('Gate ka naam'), 'Gate 2');
    await user.click(screen.getByRole('button', { name: 'Gate jodein' }));
    await waitFor(() =>
      expect(s.calls.find((c) => c.key === 'POST /admin/gates')?.body).toEqual({ siteId: 's1', name: 'Gate 2' }),
    );
  });

  it('device revoke confirms in page', async () => {
    const s = server({ 'POST /admin/devices/d1/revoke': () => json(204) });
    renderApp('/admin/devices', s);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Block karein' }));
    expect(s.calls.some((c) => c.key === 'POST /admin/devices/d1/revoke')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Haan, block karein' }));
    await waitFor(() => expect(s.calls.some((c) => c.key === 'POST /admin/devices/d1/revoke')).toBe(true));
  });

  it('security can open devices but not users', async () => {
    signIn(USERS.security);
    renderApp('/admin/devices', server());
    expect(await screen.findByRole('heading', { name: 'Devices' })).toBeInTheDocument();
  });

  it('security cannot open users', async () => {
    signIn(USERS.security);
    renderApp('/admin/users', server());
    expect(await screen.findByText('Is page ki permission aapko nahi hai.')).toBeInTheDocument();
  });

  it('non-admin cannot open /admin', async () => {
    signIn(USERS.employee);
    renderApp('/admin', server());
    expect(await screen.findByText('Is page ki permission aapko nahi hai.')).toBeInTheDocument();
  });

  it('vercel config keeps SPA routes and protects invite links', () => {
    const config = JSON.parse(readFileSync(resolve(__dirname, '../../vercel.json'), 'utf8'));
    expect(config.rewrites).toContainEqual({ source: '/(.*)', destination: '/index.html' });
    expect(config.headers).toContainEqual({
      source: '/v/(.*)',
      headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
    });
  });
});
