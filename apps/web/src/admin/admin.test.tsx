import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeServer, Handlers, json, renderApp, signIn, USERS } from '../test/harness';

const premisesList = [
  { id: 'p1', name: 'Head Office', code: 'ABC234', webSlug: 'head-office', isDefault: true, address: null, purposes: ['Meeting', 'Interview'] },
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
        verifyPhone: false,
      });
    });

    it('admin edits the purpose categories visitors pick from', async () => {
      const s = server({ 'PATCH /admin/premises/p1': ({ body }) => json(200, { ...premisesList[0], ...body }) });
      renderApp('/admin/premises', s);
      const user = userEvent.setup();
      const row = (await screen.findByRole('cell', { name: /^Head Office/ })).closest('tr') as HTMLElement;
      await user.click(within(row).getByRole('button', { name: 'Settings' }));
      const box = await screen.findByRole('region', { name: 'Head Office purposes' });
      expect(within(box).getByText('Meeting')).toBeInTheDocument();

      await user.type(within(box).getByLabelText('New purpose'), 'Yarn supply');
      await user.click(within(box).getByRole('button', { name: 'Add purpose' }));
      await waitFor(() =>
        expect(s.calls.find((c) => c.key === 'PATCH /admin/premises/p1')?.body).toEqual({ purposes: ['Meeting', 'Interview', 'Yarn supply'] }),
      );
      expect(await within(box).findByText('Yarn supply')).toBeInTheDocument();

      await user.click(within(box).getByRole('button', { name: 'Remove Interview' }));
      await waitFor(() =>
        expect(s.calls.filter((c) => c.key === 'PATCH /admin/premises/p1').at(-1)?.body).toEqual({ purposes: ['Meeting', 'Yarn supply'] }),
      );

      await user.type(within(box).getByLabelText('New purpose'), 'meeting');
      await user.click(within(box).getByRole('button', { name: 'Add purpose' }));
      expect(within(box).getByRole('alert')).toHaveTextContent('already in the list');
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

  it('security cannot open users', async () => {
    signIn(USERS.security);
    renderApp('/admin/users', server());
    expect(await screen.findByText(/You do not have access to this page/)).toBeInTheDocument();
  });

  it('an employee opening /admin lands on their own page', async () => {
    signIn(USERS.employee);
    renderApp('/admin', server({ 'GET /visits': () => json(200, []) }));
    expect(await screen.findByRole('heading', { level: 1, name: 'My visitors' })).toBeInTheDocument();
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
