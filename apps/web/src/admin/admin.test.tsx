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
const departments = [{ id: 'd-fin', name: 'Finance', memberCount: 1, designations: [{ id: 'des-mgr', name: 'Manager' }] }];
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
      await user.click(await screen.findByRole('button', { name: '+ New member' }));
      await user.type(await screen.findByLabelText('Name'), 'Ravi Kumar');
      await user.type(screen.getByLabelText('Mobile'), '9876543210');
      await user.selectOptions(screen.getByLabelText('Role'), 'employee');
      await user.selectOptions(await screen.findByLabelText('Department'), 'd-fin');
      await user.selectOptions(screen.getByLabelText('Designation'), 'Manager');
      await user.type(screen.getByLabelText('Password (at least 6 characters)'), 'Ravi@2026x');
      const premisesBox = screen.getByRole('group', { name: 'Premises' });
      await user.click(within(premisesBox).getByLabelText('Head Office'));
      await user.click(within(premisesBox).getByLabelText('Plant 2'));
      await user.click(screen.getByRole('button', { name: 'Create member' }));
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
        designation: 'Manager',
        password: 'Ravi@2026x',
      });
      // Once created, the form closes and the list is in front.
      expect(screen.queryByLabelText('Name')).toBeNull();
    });

    it('search filters the list by name or phone', async () => {
      renderApp('/admin/members', server({ 'GET /admin/users': () => json(200, [person(), person({ id: 'u2', name: 'Kavita Rao', phone: '+919855500001' })]) }));
      const user = userEvent.setup();
      await screen.findByText('Kavita Rao');
      await user.type(screen.getByLabelText('Search members'), 'kavita');
      expect(screen.queryByText('Amit Guard')).toBeNull();
      expect(screen.getByText('1 / 2 members')).toBeInTheDocument();
      await user.clear(screen.getByLabelText('Search members'));
      await user.type(screen.getByLabelText('Search members'), '98555');
      expect(screen.getByText('Kavita Rao')).toBeInTheDocument();
      await user.type(screen.getByLabelText('Search members'), '9');
      expect(await screen.findByText('No member matches that name or number.')).toBeInTheDocument();
    });

    it('needs at least one premises before calling the server', async () => {
      const s = server();
      renderApp('/admin/members', s);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: '+ New member' }));
      await user.type(await screen.findByLabelText('Name'), 'Ravi');
      await user.type(screen.getByLabelText('Mobile'), '9876543210');
      await user.type(screen.getByLabelText('Password (at least 6 characters)'), 'ravi26');
      await user.click(screen.getByRole('button', { name: 'Create member' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('at least one premises');
      expect(s.calls.some((c) => c.key === 'POST /admin/users')).toBe(false);
    });

    it('with a single premises it is ticked already, and the password is required', async () => {
      const created = person({ id: 'u2', name: 'Ravi', role: 'employee' });
      const s = server({
        'GET /admin/premises': () => json(200, [premisesList[0]]),
        'POST /admin/users': () => json(201, created),
      });
      renderApp('/admin/members', s);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: '+ New member' }));
      const premisesBox = await screen.findByRole('group', { name: 'Premises' });
      expect(await within(premisesBox).findByLabelText('Head Office')).toBeChecked();
      expect(screen.getByLabelText('Password (at least 6 characters)')).toBeRequired();
      await user.type(screen.getByLabelText('Name'), 'Ravi');
      await user.type(screen.getByLabelText('Mobile'), '9876543210');
      await user.type(screen.getByLabelText('Password (at least 6 characters)'), '482915');
      await user.click(screen.getByRole('button', { name: 'Create member' }));
      await waitFor(() => expect(s.calls.some((c) => c.key === 'POST /admin/users')).toBe(true));
      const call = s.calls.find((c) => c.key === 'POST /admin/users');
      expect(call?.body).toMatchObject({ premisesIds: ['p1'], password: '482915' });
    });

    it('duplicate phone and plan limit show the server message', async () => {
      renderApp(
        '/admin/members',
        server({
          'POST /admin/users': () =>
            json(422, { error: 'PLAN_LIMIT', message: 'Your plan allows 5 active members, and that limit has been reached.' }),
        }),
      );
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: '+ New member' }));
      await user.type(await screen.findByLabelText('Name'), 'Ravi');
      await user.type(screen.getByLabelText('Mobile'), '9876543210');
      await user.type(screen.getByLabelText('Password (at least 6 characters)'), 'ravi26');
      await user.click(within(await screen.findByRole('group', { name: 'Premises' })).getByLabelText('Head Office'));
      await user.click(screen.getByRole('button', { name: 'Create member' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('allows 5 active members');
      expect(screen.getByLabelText('Name')).toHaveValue('Ravi');
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
      await user.click(within(row).getByRole('button', { name: 'Deactivate' }));
      expect(s.calls.some((c) => c.key === 'PATCH /admin/users/u1')).toBe(false);
      await user.click(within(row).getByRole('button', { name: 'Yes, deactivate' }));
      expect(await screen.findByText('Inactive')).toBeInTheDocument();
      expect(s.calls.find((c) => c.key === 'PATCH /admin/users/u1')!.body).toEqual({ isActive: false });
    });

    it('inactive member can be turned back on', async () => {
      const s = server({
        'GET /admin/users': () => json(200, [person({ isActive: false })]),
        'PATCH /admin/users/u1': () => json(200, person()),
      });
      renderApp('/admin/members', s);
      await userEvent.setup().click(await screen.findByRole('button', { name: 'Activate' }));
      await waitFor(() => expect(s.calls.find((c) => c.key === 'PATCH /admin/users/u1')?.body).toEqual({ isActive: true }));
    });

    it('admin resets a member password', async () => {
      const s = server({ 'PUT /admin/users/u1/password': () => json(204) });
      renderApp('/admin/members', s);
      const user = userEvent.setup();
      const row = (await screen.findByText('Amit Guard')).closest('tr') as HTMLElement;
      await user.click(within(row).getByRole('button', { name: 'Password reset' }));
      await user.type(within(row).getByLabelText('New password for Amit Guard'), 'Fresh@2026x');
      await user.click(within(row).getByRole('button', { name: 'Set' }));
      expect(await within(row).findByRole('status')).toHaveTextContent('signed out');
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
      await user.type(await screen.findByLabelText('Premises name'), 'Warehouse');
      await user.type(screen.getByLabelText('Address'), 'Surat');
      await user.click(screen.getByRole('button', { name: 'Add premises' }));
      await waitFor(() =>
        expect(s.calls.find((c) => c.key === 'POST /admin/premises')?.body).toEqual({ name: 'Warehouse', address: 'Surat' }),
      );
      await user.selectOptions(await screen.findByLabelText('Gate premises'), 'p1');
      await user.type(screen.getByLabelText('Gate name'), 'Gate 2');
      await user.click(screen.getByRole('button', { name: 'Add gate' }));
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
      expect(within(form).getByLabelText('Visiting hours start')).toHaveValue('09:00');
      await user.type(within(form).getByLabelText('Overstay alert (minutes)'), '30');
      await user.click(within(form).getByLabelText('Check-in only after approval'));
      await user.click(within(form).getByRole('button', { name: 'Save settings' }));
      expect(await within(form).findByRole('status')).toHaveTextContent('Settings saved');
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
          json(422, { error: 'VALIDATION_FAILED', message: 'Visiting hours must end after they start.' }),
      });
      renderApp('/admin/premises', s);
      const user = userEvent.setup();
      const row = (await screen.findByRole('cell', { name: /^Head Office/ })).closest('tr') as HTMLElement;
      await user.click(within(row).getByRole('button', { name: 'Settings' }));
      const form = await screen.findByRole('form', { name: 'Head Office settings' });
      await user.click(within(form).getByRole('button', { name: 'Save settings' }));
      expect(await within(form).findByRole('alert')).toHaveTextContent('must end after they start');
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
      await user.type(await screen.findByLabelText('Department name'), 'HR');
      await user.click(screen.getByRole('button', { name: 'Add department' }));
      await waitFor(() => expect(s.calls.find((c) => c.key === 'POST /admin/departments')?.body).toEqual({ name: 'HR' }));

      const row = (await screen.findByText('Finance')).closest('tr') as HTMLElement;
      expect(within(row).getByText('1')).toBeInTheDocument();
      await user.click(within(row).getByRole('button', { name: 'Rename' }));
      const input = within(row).getByLabelText('New name for Finance');
      await user.clear(input);
      await user.type(input, 'Accounts');
      await user.click(within(row).getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(s.calls.find((c) => c.key === 'PATCH /admin/departments/d-fin')?.body).toEqual({ name: 'Accounts' }),
      );

      await user.click(within(row).getByRole('button', { name: 'Delete' }));
      expect(s.calls.some((c) => c.key === 'DELETE /admin/departments/d-fin')).toBe(false);
      await user.click(within(row).getByRole('button', { name: 'Yes, delete' }));
      await waitFor(() => expect(s.calls.some((c) => c.key === 'DELETE /admin/departments/d-fin')).toBe(true));
    });

    it('adds, renames and removes designations under a department', async () => {
      const s = server({
        'POST /admin/departments/d-fin/designations': () => json(201, { id: 'des-exe', name: 'Executive' }),
        'PATCH /admin/designations/des-mgr': () => json(200, { id: 'des-mgr', name: 'Senior Manager' }),
        'DELETE /admin/designations/des-mgr': () => json(204),
      });
      renderApp('/admin/departments', s);
      const user = userEvent.setup();
      const row = (await screen.findByText('Finance')).closest('tr') as HTMLElement;

      await user.type(within(row).getByLabelText('New designation in Finance'), 'Executive');
      await user.click(within(row).getByRole('button', { name: 'Add' }));
      await waitFor(() =>
        expect(s.calls.find((c) => c.key === 'POST /admin/departments/d-fin/designations')?.body).toEqual({ name: 'Executive' }),
      );
      expect(within(row).getByLabelText('New designation in Finance')).toHaveValue('');

      await user.click(within(row).getByRole('button', { name: 'Edit designation Manager in Finance' }));
      const input = within(row).getByLabelText('New name for designation Manager');
      await user.clear(input);
      await user.type(input, 'Senior Manager');
      await user.click(within(row).getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(s.calls.find((c) => c.key === 'PATCH /admin/designations/des-mgr')?.body).toEqual({ name: 'Senior Manager' }),
      );

      await user.click(within(row).getByRole('button', { name: 'Edit designation Manager in Finance' }));
      await user.click(within(row).getByRole('button', { name: 'Remove' }));
      await waitFor(() => expect(s.calls.some((c) => c.key === 'DELETE /admin/designations/des-mgr')).toBe(true));
    });

    it('member designation list follows the chosen department', async () => {
      renderApp('/admin/members', server());
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: '+ New member' }));
      const designation = await screen.findByLabelText('Designation');
      expect(designation).toBeDisabled();
      expect(designation).toHaveDisplayValue('Choose a department first');
      await user.selectOptions(await screen.findByLabelText('Department'), 'd-fin');
      expect(designation).toBeEnabled();
      await user.selectOptions(designation, 'Manager');
      expect(designation).toHaveValue('Manager');
      await user.selectOptions(screen.getByLabelText('Department'), '');
      expect(designation).toHaveValue('');
    });

    it('duplicate name shows server message', async () => {
      renderApp(
        '/admin/departments',
        server({ 'POST /admin/departments': () => json(422, { error: 'VALIDATION_FAILED', message: 'This already exists.' }) }),
      );
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText('Department name'), 'Finance');
      await user.click(screen.getByRole('button', { name: 'Add department' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
    });
  });

  it('device revoke confirms in page', async () => {
    const s = server({ 'POST /admin/devices/d1/revoke': () => json(204) });
    renderApp('/admin/devices', s);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Block' }));
    expect(s.calls.some((c) => c.key === 'POST /admin/devices/d1/revoke')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Yes, block' }));
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
    expect(await screen.findByText('You do not have access to this page.')).toBeInTheDocument();
  });

  it('non-admin cannot open /admin', async () => {
    signIn(USERS.employee);
    renderApp('/admin', server());
    expect(await screen.findByText('You do not have access to this page.')).toBeInTheDocument();
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
