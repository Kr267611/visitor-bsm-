import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeServer, Handlers, json, renderApp, signIn, USERS } from '../test/harness';

const premisesList = [{ id: 'p1', name: 'Head Office', code: 'ABC234', webSlug: 'head-office', isDefault: true, address: null }];
const departments = [
  { id: 'd-mis', name: 'MIS', memberCount: 2, designations: [{ id: 'des-exe', name: 'Executive' }, { id: 'des-mgr', name: 'Manager' }] },
  { id: 'd-qc', name: 'QC', memberCount: 0, designations: [] },
];
const person = (over: object = {}) => ({
  id: 'u1',
  name: 'Abhishek Sah',
  phone: '+916352872742',
  email: null,
  role: 'employee',
  departmentId: 'd-mis',
  designation: 'Executive',
  joiningDate: null,
  isHost: true,
  isActive: true,
  premisesIds: ['p1'],
  modules: [],
  lastLoginAt: null,
  ...over,
});
const people = [
  person(),
  person({ id: 'u2', name: 'Alka Mishra', phone: '+919198164246', role: 'guard', departmentId: 'd-qc', designation: null, lastLoginAt: new Date().toISOString() }),
  person({ id: 'u3', name: 'Zubin Old', phone: '+919811100003', departmentId: null, designation: null, isActive: false }),
  person({ id: USERS.admin.id, name: 'Deepak Mishra', phone: '+919753389708', role: 'admin', departmentId: null, designation: null }),
];
const ALL = ['desk', 'visitors', 'users', 'premises', 'departments', 'devices'];

function server(over: Handlers = {}) {
  return fakeServer({
    'GET /admin/users': () => json(200, people),
    'GET /admin/premises': () => json(200, premisesList),
    'GET /admin/departments': () => json(200, departments),
    'GET /me': () => json(200, { delegateId: null, modules: ALL, features: ['dashboard', 'invites', 'bulk_import'] }),
    'GET /dashboard/live': () => json(200, { pending: [], needsCall: [], expected: [], inside: [] }),
    ...over,
  });
}

const rowOf = async (name: string) => (await screen.findByText(name)).closest('tr') as HTMLElement;
const names = () =>
  within(screen.getByRole('region', { name: 'Users list' }))
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('cell')[0].querySelector('strong')?.textContent);

describe('users panel', () => {
  beforeEach(() => signIn(USERS.admin));

  it('shows active of total, hides inactive by default, and filters', async () => {
    renderApp('/admin/users', server());
    expect(await screen.findByText('3 active of 4')).toBeInTheDocument();
    await screen.findByText('Abhishek Sah');
    expect(names()).toEqual(['Abhishek Sah', 'Alka Mishra', 'Deepak Mishra']);
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText('Department filter'), 'd-mis');
    expect(names()).toEqual(['Abhishek Sah']);
    await user.selectOptions(screen.getByLabelText('Department filter'), '');
    await user.selectOptions(screen.getByLabelText('Role filter'), 'guard');
    expect(names()).toEqual(['Alka Mishra']);
    await user.selectOptions(screen.getByLabelText('Role filter'), '');
    await user.selectOptions(screen.getByLabelText('Last login filter'), 'never');
    expect(names()).toEqual(['Abhishek Sah', 'Deepak Mishra']);
    await user.selectOptions(screen.getByLabelText('Last login filter'), '');
    await user.selectOptions(screen.getByLabelText('Status filter'), 'inactive');
    expect(names()).toEqual(['Zubin Old']);
    await user.selectOptions(screen.getByLabelText('Status filter'), '');
    await user.type(screen.getByLabelText('Search users'), 'exec');
    expect(names()).toEqual(['Abhishek Sah']);
  });

  it('sorts by a column, and again in reverse', async () => {
    renderApp('/admin/users', server());
    await screen.findByText('Abhishek Sah');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Name/ }));
    expect(names()).toEqual(['Deepak Mishra', 'Alka Mishra', 'Abhishek Sah']);
    await user.click(screen.getByRole('button', { name: /Last login/ }));
    expect(names()[0]).not.toBe('Alka Mishra');
    await user.click(screen.getByRole('button', { name: /Last login/ }));
    expect(names()[0]).toBe('Alka Mishra');
    expect(screen.getByRole('columnheader', { name: /Last login/ })).toHaveAttribute('aria-sort', 'descending');
  });

  it('creates a user with department, designation and narrowed module access', async () => {
    const s = server({ 'POST /admin/users': () => json(201, person({ id: 'u9' })) });
    renderApp('/admin/users', s);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '+ New user' }));
    const form = screen.getByRole('form', { name: 'New user' });
    await user.type(within(form).getByLabelText('Name'), 'Ravi Kumar');
    await user.type(within(form).getByLabelText('Mobile'), '9876543210');
    await user.selectOptions(within(form).getByLabelText('Role'), 'reception');
    await user.selectOptions(within(form).getByLabelText('Department'), 'd-mis');
    await user.selectOptions(within(form).getByLabelText('Designation'), 'Manager');
    await user.type(within(form).getByLabelText('Password (at least 6 characters)'), '482915');
    const access = within(form).getByRole('group', { name: 'Module access' });
    // Reception may have Gate desk and My visitors; both start ticked.
    expect(within(access).getAllByRole('checkbox').map((c) => (c as HTMLInputElement).checked)).toEqual([true, true]);
    await user.click(within(access).getByLabelText('My visitors'));
    await user.click(within(form).getByRole('button', { name: 'Create user' }));
    await waitFor(() => expect(s.calls.some((c) => c.key === 'POST /admin/users')).toBe(true));
    expect(s.calls.find((c) => c.key === 'POST /admin/users')!.body).toEqual({
      name: 'Ravi Kumar',
      phone: '9876543210',
      role: 'reception',
      premisesIds: ['p1'],
      isHost: true,
      departmentId: 'd-mis',
      designation: 'Manager',
      modules: ['desk'],
      password: '482915',
    });
    expect(await screen.findByText('Ravi Kumar added.')).toBeInTheDocument();
  });

  it('everything ticked is saved as "no narrowing"; unticking all is refused', async () => {
    const s = server({ 'PATCH /admin/users/u2': () => json(200, person()) });
    renderApp('/admin/users', s);
    const user = userEvent.setup();
    await user.click(within(await rowOf('Alka Mishra')).getByRole('button', { name: 'Edit Alka Mishra' }));
    const form = screen.getByRole('form', { name: 'Edit Alka Mishra' });
    const access = within(form).getByRole('group', { name: 'Module access' });
    await user.click(within(access).getByLabelText('Gate desk'));
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Tick at least one module');
    await user.click(within(access).getByLabelText('Gate desk'));
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(s.calls.some((c) => c.key === 'PATCH /admin/users/u2')).toBe(true));
    expect(s.calls.find((c) => c.key === 'PATCH /admin/users/u2')!.body).toMatchObject({ role: 'guard', modules: [] });
  });

  it('editing yourself: no role change, no deactivate, Users access locked', async () => {
    renderApp('/admin/users', server());
    const user = userEvent.setup();
    const row = await rowOf('Deepak Mishra');
    expect(within(row).queryByRole('button', { name: /Deactivate/ })).toBeNull();
    await user.click(within(row).getByRole('button', { name: 'Edit Deepak Mishra' }));
    const form = screen.getByRole('form', { name: 'Edit Deepak Mishra' });
    expect(within(form).getByLabelText('Role')).toBeDisabled();
    expect(within(form).getByLabelText(/^Users/)).toBeDisabled();
    expect(within(form).getByLabelText('Mobile')).toHaveAttribute('readonly');
  });

  it('admin sets a new password from the edit form', async () => {
    const s = server({ 'PUT /admin/users/u1/password': () => json(204) });
    renderApp('/admin/users', s);
    const user = userEvent.setup();
    await user.click(within(await rowOf('Abhishek Sah')).getByRole('button', { name: 'Edit Abhishek Sah' }));
    await user.type(screen.getByLabelText('Set a new password'), 'fresh1');
    await user.click(screen.getByRole('button', { name: 'Set password' }));
    expect(await screen.findByText(/signed out of other devices/)).toBeInTheDocument();
    expect(s.calls.find((c) => c.key === 'PUT /admin/users/u1/password')!.body).toEqual({ password: 'fresh1' });
  });

  it('deactivate asks first', async () => {
    const s = server({ 'PATCH /admin/users/u1': () => json(200, person({ isActive: false })) });
    renderApp('/admin/users', s);
    const user = userEvent.setup();
    const row = await rowOf('Abhishek Sah');
    await user.click(within(row).getByRole('button', { name: 'Deactivate Abhishek Sah' }));
    expect(s.calls.some((c) => c.key === 'PATCH /admin/users/u1')).toBe(false);
    await user.click(within(row).getByRole('button', { name: 'Yes, deactivate' }));
    await waitFor(() => expect(s.calls.find((c) => c.key === 'PATCH /admin/users/u1')?.body).toEqual({ isActive: false }));
  });

  it('old /admin/members link opens Users', async () => {
    renderApp('/admin/members', server());
    expect(await screen.findByRole('heading', { level: 1, name: 'Users' })).toBeInTheDocument();
  });
});

describe('bulk upload', () => {
  beforeEach(() => signIn(USERS.admin));

  const csv = (text: string) => new File([text], 'users.csv', { type: 'text/csv' });

  it('reads the CSV, uploads, and reports what was created', async () => {
    const s = server({
      'POST /admin/users/import': () => json(200, { created: 2, departmentsCreated: 1, designationsCreated: 0 }),
    });
    renderApp('/admin/users', s);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bulk upload' }));
    await user.upload(
      screen.getByLabelText('CSV file'),
      csv('Name,Mobile,Department,Password,Notes\nAmit,9811100001,Stores,amit26,x\nRita,9811100002,,rita26,\n'),
    );
    expect(await screen.findByText(/2 user\(s\) ready to upload/)).toBeInTheDocument();
    expect(screen.getByText('These columns are ignored: Notes.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Upload 2 user(s)' }));
    expect(await screen.findByText('2 user(s) added, with 1 new department(s).')).toBeInTheDocument();
    expect(s.calls.find((c) => c.key === 'POST /admin/users/import')!.body).toEqual({
      rows: [
        { name: 'Amit', mobile: '9811100001', department: 'Stores', password: 'amit26' },
        { name: 'Rita', mobile: '9811100002', password: 'rita26' },
      ],
    });
  });

  it('lists every line the server refused', async () => {
    renderApp(
      '/admin/users',
      server({
        'POST /admin/users/import': () =>
          json(422, {
            error: 'VALIDATION_FAILED',
            message: '2 row(s) need fixing. Nothing was saved.',
            rows: [
              { line: 2, errors: ['A user with this mobile already exists.'] },
              { line: 3, errors: ['Password must be at least 6 characters.'] },
            ],
          }),
      }),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bulk upload' }));
    await user.upload(screen.getByLabelText('CSV file'), csv('Name,Mobile,Password\nA,9811100001,aaaaaa\nB,9811100002,b\n'));
    await user.click(await screen.findByRole('button', { name: 'Upload 2 user(s)' }));
    expect(await screen.findByText('2 row(s) need fixing. Nothing was saved.')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Lines to fix' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Line 2: A user with this mobile already exists.',
      'Line 3: Password must be at least 6 characters.',
    ]);
  });

  it('refuses a file without the required columns', async () => {
    const s = server();
    renderApp('/admin/users', s);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bulk upload' }));
    await user.upload(screen.getByLabelText('CSV file'), csv('Name,Email\nA,a@b.in\n'));
    expect(await screen.findByText('The file has no Mobile, Password column.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
  });
});

describe('designations panel', () => {
  beforeEach(() => signIn(USERS.admin));

  it('sets a person designation straight from the list', async () => {
    const s = server({ 'PATCH /admin/users/u1': () => json(200, person({ designation: 'Manager' })) });
    renderApp('/admin/designations', s);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Designation of Abhishek Sah'), 'Manager');
    await waitFor(() => expect(s.calls.find((c) => c.key === 'PATCH /admin/users/u1')?.body).toEqual({ designation: 'Manager' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('moving someone to another department clears the designation', async () => {
    const s = server({ 'PATCH /admin/users/u1': () => json(200, person({ departmentId: 'd-qc', designation: null })) });
    renderApp('/admin/designations', s);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Department of Abhishek Sah'), 'd-qc');
    await waitFor(() =>
      expect(s.calls.find((c) => c.key === 'PATCH /admin/users/u1')?.body).toEqual({ departmentId: 'd-qc', designation: null }),
    );
  });

  it('choosing a department shows only its people and lets you manage its designations', async () => {
    renderApp('/admin/designations', server());
    const user = userEvent.setup();
    await screen.findByLabelText('Designation of Abhishek Sah');
    await user.selectOptions(screen.getByLabelText('Department'), 'd-mis');
    expect(screen.getByRole('region', { name: 'Designations in MIS' })).toBeInTheDocument();
    expect(screen.getByLabelText('New designation in MIS')).toBeInTheDocument();
    expect(screen.queryByLabelText('Designation of Alka Mishra')).toBeNull();
    expect(screen.getByText('1 people, 0 without a designation')).toBeInTheDocument();
  });
});

describe('module access in the menu and pages', () => {
  it('an admin with only Users sees only Users, and other pages are refused', async () => {
    signIn(USERS.admin);
    const s = server({ 'GET /me': () => json(200, { delegateId: null, modules: ['users'], features: ['dashboard'] }) });
    renderApp('/admin/users', s);
    await screen.findByRole('heading', { level: 1, name: 'Users' });
    const menu = screen.getByRole('navigation', { name: 'Main' });
    await waitFor(() => expect(within(menu).getAllByRole('link').map((l) => l.textContent?.trim())).toEqual(['Users']));
  });

  it('a page outside your modules says so', async () => {
    signIn(USERS.admin);
    renderApp('/admin/departments', server({ 'GET /me': () => json(200, { delegateId: null, modules: ['users'], features: [] }) }));
    expect(await screen.findByText(/You do not have access to this page/)).toBeInTheDocument();
  });

  it('home sends you to the first page you can open', async () => {
    signIn(USERS.admin);
    renderApp('/', server({ 'GET /me': () => json(200, { delegateId: null, modules: ['departments'], features: [] }) }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Departments' })).toBeInTheDocument();
  });
});
