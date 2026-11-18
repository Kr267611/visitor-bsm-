import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeServer, Handlers, json, renderApp, signIn, USERS } from '../test/harness';

const premisesList = [
  { id: 'p1', name: 'Head Office', code: 'ABC234', webSlug: 'head-office', isDefault: true, address: null },
  { id: 'p2', name: 'Plant 2', code: 'XYZ789', webSlug: 'plant-2', isDefault: false, address: null },
];
const gates = [{ id: 'g1', name: 'Main Gate 1', premisesId: 'p1', isActive: true }];
const departments = [{ id: 'd-fin', name: 'Finance', memberCount: 1 }];
const person = (over: object = {}) => ({
  id: 'u1',
  name: 'Amit Guard',
  phone: '+919000000002',
  email: null,
  role: 'guard',
  departmentId: null,
  designation: null,
  joiningDate: null,
  isHost: false,
  isActive: true,
  premisesIds: ['p1'],
  ...over,
});
const settings = {
  premisesId: 'p1',
  visitStart: '09:00',
  visitEnd: null,
  checkinOnApproval: true,
  onlyCheckin: false,
  autoCheckoutHrs: null,
  overstayMin: null,
  waitingMin: null,
  defaultVisitMin: 240,
  slotMin: 30,
  delayAlertMin: null,
  onlyMemberCheckin: false,
  reportEmails: [],
  reportSchedule: null,
  googleReviewUrl: null,
};

function server(over: Handlers = {}) {
  return fakeServer({
    'GET /admin/users': () => json(200, [person()]),
    'GET /admin/premises': () => json(200, premisesList),
    'GET /admin/gates': () => json(200, gates),
    'GET /admin/departments': () => json(200, departments),
    'GET /admin/premises/p1/settings': () => json(200, settings),
    'GET /me': () => json(200, { delegateId: null }),
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

  describe('members', () => {
    it('creates a member with premises, department and password', async () => {
      const created = person({ id: 'u2', name: 'Ravi Kumar', role: 'employee', departmentId: 'd-fin', premisesIds: ['p1', 'p2'] });
      const s = server({
        'POST /admin/users': () => {
          s.handlers['GET /admin/users'] = () => json(200, [person(), created]);
          return json(201, created);
        },
      });
      renderApp('/admin/members', s);
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText('Naam'), 'Ravi Kumar');
      await user.type(screen.getByLabelText('Mobile'), '9876543210');
      await user.selectOptions(screen.getByLabelText('Role'), 'employee');
      await user.selectOptions(await screen.findByLabelText('Department'), 'd-fin');
      await user.type(screen.getByLabelText('Password (optional)'), 'Ravi@2026x');
      const premisesBox = screen.getByRole('group', { name: 'Premises' });
      await user.click(within(premisesBox).getByLabelText('Head Office'));
      await user.click(within(premisesBox).getByLabelText('Plant 2'));
      await user.click(screen.getByRole('button', { name: 'Member banayein' }));
      const row = (await screen.findByText('Ravi Kumar')).closest('tr') as HTMLElement;
      expect(within(row).getByText('Finance')).toBeInTheDocument();
      expect(within(row).getByText('Head Office, Plant 2')).toBeInTheDocument();
      expect(s.calls.find((c) => c.key === 'POST /admin/users')!.body).toEqual({
        name: 'Ravi Kumar',
        phone: '9876543210',
        role: 'employee',
        premisesIds: ['p1', 'p2'],
        isHost: true,
        departmentId: 'd-fin',
        password: 'Ravi@2026x',
      });
      expect(screen.getByLabelText('Naam')).toHaveValue('');
    });

    it('needs at least one premises before calling the server', async () => {
      const s = server();
      renderApp('/admin/members', s);
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText('Naam'), 'Ravi');
      await user.type(screen.getByLabelText('Mobile'), '9876543210');
      await user.click(screen.getByRole('button', { name: 'Member banayein' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('ek premises');
      expect(s.calls.some((c) => c.key === 'POST /admin/users')).toBe(false);
    });

    it('duplicate phone and plan limit show the server message', async () => {
      renderApp(
        '/admin/members',
        server({
          'POST /admin/users': () =>
            json(422, { error: 'PLAN_LIMIT', message: 'Aapke plan mein active members ki limit (5) poori ho gayi.' }),
        }),
      );
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText('Naam'), 'Ravi');
      await user.type(screen.getByLabelText('Mobile'), '9876543210');
      await user.click(within(await screen.findByRole('group', { name: 'Premises' })).getByLabelText('Head Office'));
      await user.click(screen.getByRole('button', { name: 'Member banayein' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('limit (5)');
      expect(screen.getByLabelText('Naam')).toHaveValue('Ravi');
    });

    it('deactivate confirms in page, then marks inactive', async () => {
      const s = server({
        'PATCH /admin/users/u1': () => {
          s.handlers['GET /admin/users'] = () => json(200, [person({ isActive: false })]);
          return json(200, person({ isActive: false }));
        },
      });
      renderApp('/admin/members', s);
      const user = userEvent.setup();
      const row = (await screen.findByText('Amit Guard')).closest('tr') as HTMLElement;
      await user.click(within(row).getByRole('button', { name: 'Band karein' }));
      expect(s.calls.some((c) => c.key === 'PATCH /admin/users/u1')).toBe(false);
      await user.click(within(row).getByRole('button', { name: 'Haan, band karein' }));
      expect(await screen.findByText('Band hai')).toBeInTheDocument();
      expect(s.calls.find((c) => c.key === 'PATCH /admin/users/u1')!.body).toEqual({ isActive: false });
    });

    it('inactive member can be turned back on', async () => {
      const s = server({
        'GET /admin/users': () => json(200, [person({ isActive: false })]),
        'PATCH /admin/users/u1': () => json(200, person()),
      });
      renderApp('/admin/members', s);
      await userEvent.setup().click(await screen.findByRole('button', { name: 'Chalu karein' }));
      await waitFor(() => expect(s.calls.find((c) => c.key === 'PATCH /admin/users/u1')?.body).toEqual({ isActive: true }));
    });

    it('admin resets a member password', async () => {
      const s = server({ 'PUT /admin/users/u1/password': () => json(204) });
      renderApp('/admin/members', s);
      const user = userEvent.setup();
      const row = (await screen.findByText('Amit Guard')).closest('tr') as HTMLElement;
      await user.click(within(row).getByRole('button', { name: 'Password reset' }));
      await user.type(within(row).getByLabelText('Amit Guard ka naya password'), 'Fresh@2026x');
      await user.click(within(row).getByRole('button', { name: 'Set karein' }));
      expect(await within(row).findByRole('status')).toHaveTextContent('logout');
      expect(s.calls.find((c) => c.key === 'PUT /admin/users/u1/password')!.body).toEqual({ password: 'Fresh@2026x' });
    });

    it('old /admin/users link opens members', async () => {
      renderApp('/admin/users', server());
      expect(await screen.findByRole('heading', { level: 1, name: 'Members' })).toBeInTheDocument();
    });
  });

  describe('premises', () => {
    it('adds premises and gate', async () => {
      const s = server({
        'POST /admin/premises': () => json(201, { ...premisesList[1], id: 'p3', name: 'Warehouse' }),
        'POST /admin/gates': () => json(201, { id: 'g2', name: 'Gate 2', premisesId: 'p1', isActive: true }),
      });
      renderApp('/admin/premises', s);
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText('Premises ka naam'), 'Warehouse');
      await user.type(screen.getByLabelText('Pata'), 'Surat');
      await user.click(screen.getByRole('button', { name: 'Premises jodein' }));
      await waitFor(() =>
        expect(s.calls.find((c) => c.key === 'POST /admin/premises')?.body).toEqual({ name: 'Warehouse', address: 'Surat' }),
      );
      await user.selectOptions(await screen.findByLabelText('Gate ka premises'), 'p1');
      await user.type(screen.getByLabelText('Gate ka naam'), 'Gate 2');
      await user.click(screen.getByRole('button', { name: 'Gate jodein' }));
      await waitFor(() =>
        expect(s.calls.find((c) => c.key === 'POST /admin/gates')?.body).toEqual({ premisesId: 'p1', name: 'Gate 2' }),
      );
    });

    it('lists kiosk code, default badge and gates', async () => {
      renderApp('/admin/premises', server());
      const row = (await screen.findByRole('cell', { name: /^Head Office/ })).closest('tr') as HTMLElement;
      expect(within(row).getByText('ABC234')).toBeInTheDocument();
      expect(within(row).getByText('Default')).toBeInTheDocument();
      expect(within(row).getByText('Main Gate 1')).toBeInTheDocument();
    });

    it('opens settings and saves changes', async () => {
      const s = server({ 'PUT /admin/premises/p1/settings': ({ body }) => json(200, { ...settings, ...body }) });
      renderApp('/admin/premises', s);
      const user = userEvent.setup();
      const row = (await screen.findByRole('cell', { name: /^Head Office/ })).closest('tr') as HTMLElement;
      await user.click(within(row).getByRole('button', { name: 'Settings' }));
      const form = await screen.findByRole('form', { name: 'Head Office settings' });
      expect(within(form).getByLabelText('Visit shuru (HH:MM)')).toHaveValue('09:00');
      await user.type(within(form).getByLabelText('Overstay alert (minute)'), '30');
      await user.click(within(form).getByLabelText('Approval ke baad hi check-in'));
      await user.click(within(form).getByRole('button', { name: 'Settings save karein' }));
      expect(await within(form).findByRole('status')).toHaveTextContent('save ho gayin');
      expect(s.calls.find((c) => c.key === 'PUT /admin/premises/p1/settings')!.body).toEqual({
        visitStart: '09:00',
        visitEnd: null,
        defaultVisitMin: 240,
        overstayMin: 30,
        checkinOnApproval: false,
      });
    });

    it('settings error from server is shown', async () => {
      const s = server({
        'PUT /admin/premises/p1/settings': () =>
          json(422, { error: 'VALIDATION_FAILED', message: 'Visit ka end time start ke baad ka hona chahiye.' }),
      });
      renderApp('/admin/premises', s);
      const user = userEvent.setup();
      const row = (await screen.findByRole('cell', { name: /^Head Office/ })).closest('tr') as HTMLElement;
      await user.click(within(row).getByRole('button', { name: 'Settings' }));
      const form = await screen.findByRole('form', { name: 'Head Office settings' });
      await user.click(within(form).getByRole('button', { name: 'Settings save karein' }));
      expect(await within(form).findByRole('alert')).toHaveTextContent('end time');
    });
  });

  describe('departments', () => {
    it('adds, renames and deletes with confirmation', async () => {
      const s = server({
        'POST /admin/departments': () => json(201, { id: 'd-hr', name: 'HR' }),
        'PATCH /admin/departments/d-fin': () => json(200, { id: 'd-fin', name: 'Accounts' }),
        'DELETE /admin/departments/d-fin': () => json(204),
      });
      renderApp('/admin/departments', s);
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText('Department ka naam'), 'HR');
      await user.click(screen.getByRole('button', { name: 'Department jodein' }));
      await waitFor(() => expect(s.calls.find((c) => c.key === 'POST /admin/departments')?.body).toEqual({ name: 'HR' }));

      const row = (await screen.findByText('Finance')).closest('tr') as HTMLElement;
      expect(within(row).getByText('1')).toBeInTheDocument();
      await user.click(within(row).getByRole('button', { name: 'Naam badlein' }));
      const input = within(row).getByLabelText('Finance ka naya naam');
      await user.clear(input);
      await user.type(input, 'Accounts');
      await user.click(within(row).getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(s.calls.find((c) => c.key === 'PATCH /admin/departments/d-fin')?.body).toEqual({ name: 'Accounts' }),
      );

      await user.click(within(row).getByRole('button', { name: 'Hatayein' }));
      expect(s.calls.some((c) => c.key === 'DELETE /admin/departments/d-fin')).toBe(false);
      await user.click(within(row).getByRole('button', { name: 'Haan, hatayein' }));
      await waitFor(() => expect(s.calls.some((c) => c.key === 'DELETE /admin/departments/d-fin')).toBe(true));
    });

    it('duplicate name shows server message', async () => {
      renderApp(
        '/admin/departments',
        server({ 'POST /admin/departments': () => json(422, { error: 'VALIDATION_FAILED', message: 'Yeh pehle se maujood hai.' }) }),
      );
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText('Department ka naam'), 'Finance');
      await user.click(screen.getByRole('button', { name: 'Department jodein' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('pehle se maujood');
    });
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

  it('security can open devices but not members', async () => {
    signIn(USERS.security);
    renderApp('/admin/devices', server());
    expect(await screen.findByRole('heading', { name: 'Devices' })).toBeInTheDocument();
  });

  it('security cannot open members', async () => {
    signIn(USERS.security);
    renderApp('/admin/members', server());
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
