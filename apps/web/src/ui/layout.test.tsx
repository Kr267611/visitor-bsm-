import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeServer, Handlers, json, renderApp, signIn, USERS } from '../test/harness';

vi.mock('socket.io-client', () => ({
  io: () => ({ on() {}, disconnect() {}, connect() {} }),
}));

const summary = (id: string) => ({
  id,
  code: id,
  status: 'APPROVED',
  visitorName: id,
  company: null,
  photoUrl: null,
  hostName: 'A',
  validFrom: '2026-11-05T04:30:00.000Z',
  validTo: '2026-11-05T07:30:00.000Z',
  checkedInAt: null,
});

function server(over: Handlers = {}) {
  return fakeServer({
    'GET /dashboard/live': () =>
      json(200, {
        inside: [summary('a')],
        expected: [summary('b'), summary('c')],
        pending: [summary('d')],
        needsCall: [{ ...summary('e'), hostPhone: 'x' }],
      }),
    'GET /gates': () => json(200, []),
    'GET /visits': () => json(200, []),
    'GET /admin/users': () => json(200, []),
    'GET /admin/premises': () => json(200, []),
    'GET /admin/departments': () => json(200, []),
    'GET /me': () => json(200, { delegateId: null, delegateName: null }),
    ...over,
  });
}

const menu = () => screen.getByRole('navigation', { name: 'Main' });
const groups = () => within(menu()).getAllByRole('heading', { level: 2 }).map((h) => h.textContent);

describe('side menu', () => {
  beforeEach(() => localStorage.clear());

  it('reception sees Gate desk and My visitors groups', async () => {
    signIn(USERS.reception);
    renderApp('/desk/pending', server());
    await screen.findByRole('heading', { level: 1, name: 'Awaiting approval' });
    expect(groups()).toEqual(['Gate desk', 'My visitors']);
    expect(within(menu()).queryByRole('link', { name: 'Users' })).toBeNull();
  });

  it('employee sees only My visitors, with no live connection needed', async () => {
    signIn(USERS.employee);
    const s = server();
    renderApp('/my', s);
    await screen.findByRole('heading', { level: 1, name: 'My visitors' });
    expect(groups()).toEqual(['My visitors']);
    expect(within(menu()).getByRole('link', { name: 'New invite' })).toHaveAttribute('href', '/my/invite');
    expect(within(menu()).getByRole('link', { name: 'Backup person' })).toHaveAttribute('href', '/my/backup');
    expect(s.calls.some((c) => c.key === 'GET /dashboard/live')).toBe(false);
  });

  it('admin sees all three groups', async () => {
    signIn(USERS.admin);
    renderApp('/admin/users', server());
    await screen.findByRole('heading', { level: 1, name: 'Users' });
    expect(groups()).toEqual(['Gate desk', 'My visitors', 'Admin']);
    expect(within(menu()).getByRole('link', { name: 'Premises & gates' })).toBeInTheDocument();
    expect(within(menu()).getByRole('link', { name: 'Departments' })).toBeInTheDocument();
    expect(within(menu()).getByRole('link', { name: 'Designations' })).toBeInTheDocument();
    expect(within(menu()).getByRole('link', { name: 'Devices' })).toBeInTheDocument();
  });

  it('guard sees only the desk group', async () => {
    signIn(USERS.guard);
    renderApp('/desk/inside', server());
    await screen.findByRole('heading', { level: 1, name: 'Inside' });
    expect(groups()).toEqual(['Gate desk']);
  });

  it('security also sees Devices', async () => {
    signIn(USERS.security);
    renderApp('/admin/devices', server({ 'GET /admin/devices': () => json(200, []) }));
    await screen.findByRole('heading', { level: 1, name: 'Devices' });
    expect(within(menu()).getByRole('link', { name: 'Devices' })).toBeInTheDocument();
    expect(within(menu()).queryByRole('link', { name: 'Users' })).toBeNull();
  });

  it('counts show next to each desk page, calls included in approvals', async () => {
    signIn(USERS.reception);
    renderApp('/desk/inside', server());
    expect(await within(menu()).findByRole('link', { name: 'Awaiting approval 2' })).toBeInTheDocument();
    expect(within(menu()).getByRole('link', { name: 'Expected 2' })).toBeInTheDocument();
    expect(within(menu()).getByRole('link', { name: 'Inside 1' })).toBeInTheDocument();
  });

  it('current page is marked in the menu', async () => {
    signIn(USERS.employee);
    renderApp('/my/invite', server());
    await screen.findByRole('heading', { level: 1, name: 'New invite' });
    expect(within(menu()).getByRole('link', { name: 'New invite' })).toHaveAttribute('aria-current', 'page');
    expect(within(menu()).getByRole('link', { name: 'Visitor list' })).not.toHaveAttribute('aria-current');
  });

  it('phone: Menu button opens the menu and choosing a page closes it', async () => {
    signIn(USERS.employee);
    renderApp('/my', server());
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'Menu' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await user.click(within(menu()).getByRole('link', { name: 'New invite' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'New invite' })).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('backup person has its own page, not on the list page', async () => {
    signIn(USERS.employee);
    renderApp('/my', server());
    await screen.findByRole('heading', { level: 1, name: 'My visitors' });
    expect(screen.queryByLabelText('Search for a backup person')).not.toBeInTheDocument();
  });

  it('backup page opens from its route', async () => {
    signIn(USERS.employee);
    renderApp('/my/backup', server());
    expect(await screen.findByLabelText('Search for a backup person')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Backup person' })).toBeInTheDocument();
  });

  describe('business, premises and plan', () => {
    const profile = (over: object = {}) => ({
      delegateId: null,
      delegateName: null,
      business: { id: 'b1', name: 'Acme Pvt Ltd', slug: 'acme' },
      premises: [
        { id: 'p1', name: 'Head Office', isDefault: true },
        { id: 'p2', name: 'Plant 2', isDefault: false },
      ],
      activePremisesId: 'p1',
      features: ['dashboard', 'invites', 'visitor_desk'],
      ...over,
    });

    it('shows business name and switches premises for every request', async () => {
      signIn(USERS.reception);
      const s = server({ 'GET /me': () => json(200, profile()) });
      renderApp('/desk/pending', s);
      expect(await within(menu().parentElement as HTMLElement).findByText('Acme Pvt Ltd')).toBeInTheDocument();
      const select = await screen.findByLabelText('Premises');
      expect(select).toHaveValue('p1');
      const before = s.calls.length;
      await userEvent.setup().selectOptions(select, 'p2');
      expect(localStorage.getItem('visitor.premises')).toBe('"p2"');
      await screen.findByRole('heading', { level: 1, name: 'Awaiting approval' });
      await vi.waitFor(() => {
        const later = s.calls.slice(before).find((c) => c.key === 'GET /dashboard/live');
        expect((later?.init.headers as Record<string, string>)['X-Premises-Id']).toBe('p2');
      });
    });

    it('one premises shows its name, no switcher', async () => {
      signIn(USERS.employee);
      renderApp('/my', server({ 'GET /me': () => json(200, profile({ premises: [{ id: 'p1', name: 'Head Office', isDefault: true }] })) }));
      expect(await screen.findByText('Head Office')).toBeInTheDocument();
      expect(screen.queryByLabelText('Premises')).toBeNull();
    });

    it('modules not in the plan are hidden from the menu', async () => {
      signIn(USERS.reception);
      renderApp('/my', server({ 'GET /me': () => json(200, profile({ features: ['visitor_desk'] })) }));
      await screen.findByRole('heading', { level: 1, name: 'My visitors' });
      await vi.waitFor(() => expect(groups()).toEqual(['My visitors']));
      expect(within(menu()).queryByRole('link', { name: 'New invite' })).toBeNull();
    });
  });
});
