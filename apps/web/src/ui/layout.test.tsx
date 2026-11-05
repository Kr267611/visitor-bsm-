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
    'GET /admin/sites': () => json(200, []),
    'GET /me': () => json(200, { delegateId: null, delegateName: null }),
    ...over,
  });
}

const menu = () => screen.getByRole('navigation', { name: 'Main' });
const groups = () => within(menu()).getAllByRole('heading', { level: 2 }).map((h) => h.textContent);

describe('side menu', () => {
  beforeEach(() => localStorage.clear());

  it('reception sees Gate desk and Mere visitors groups', async () => {
    signIn(USERS.reception);
    renderApp('/desk/pending', server());
    await screen.findByRole('heading', { level: 1, name: 'Approval baaki' });
    expect(groups()).toEqual(['Gate desk', 'Mere visitors']);
    expect(within(menu()).queryByRole('link', { name: 'Users' })).toBeNull();
  });

  it('employee sees only Mere visitors, with no live connection needed', async () => {
    signIn(USERS.employee);
    const s = server();
    renderApp('/my', s);
    await screen.findByRole('heading', { level: 1, name: 'Mere visitors' });
    expect(groups()).toEqual(['Mere visitors']);
    expect(within(menu()).getByRole('link', { name: 'Naya invite' })).toHaveAttribute('href', '/my/invite');
    expect(within(menu()).getByRole('link', { name: 'Backup person' })).toHaveAttribute('href', '/my/backup');
    expect(s.calls.some((c) => c.key === 'GET /dashboard/live')).toBe(false);
  });

  it('admin sees all three groups', async () => {
    signIn(USERS.admin);
    renderApp('/admin/users', server());
    await screen.findByRole('heading', { level: 1, name: 'Users' });
    expect(groups()).toEqual(['Gate desk', 'Mere visitors', 'Admin']);
    expect(within(menu()).getByRole('link', { name: 'Sites aur gates' })).toBeInTheDocument();
    expect(within(menu()).getByRole('link', { name: 'Devices' })).toBeInTheDocument();
  });

  it('guard sees only the desk group', async () => {
    signIn(USERS.guard);
    renderApp('/desk/inside', server());
    await screen.findByRole('heading', { level: 1, name: 'Andar hain' });
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
    expect(await within(menu()).findByRole('link', { name: 'Approval baaki 2' })).toBeInTheDocument();
    expect(within(menu()).getByRole('link', { name: 'Aane wale 2' })).toBeInTheDocument();
    expect(within(menu()).getByRole('link', { name: 'Andar hain 1' })).toBeInTheDocument();
  });

  it('current page is marked in the menu', async () => {
    signIn(USERS.employee);
    renderApp('/my/invite', server());
    await screen.findByRole('heading', { level: 1, name: 'Naya invite' });
    expect(within(menu()).getByRole('link', { name: 'Naya invite' })).toHaveAttribute('aria-current', 'page');
    expect(within(menu()).getByRole('link', { name: 'Visitors ki list' })).not.toHaveAttribute('aria-current');
  });

  it('phone: Menu button opens the menu and choosing a page closes it', async () => {
    signIn(USERS.employee);
    renderApp('/my', server());
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'Menu' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await user.click(within(menu()).getByRole('link', { name: 'Naya invite' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Naya invite' })).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('backup person has its own page, not on the list page', async () => {
    signIn(USERS.employee);
    renderApp('/my', server());
    await screen.findByRole('heading', { level: 1, name: 'Mere visitors' });
    expect(screen.queryByLabelText('Backup person dhoondein')).not.toBeInTheDocument();
  });

  it('backup page opens from its route', async () => {
    signIn(USERS.employee);
    renderApp('/my/backup', server());
    expect(await screen.findByLabelText('Backup person dhoondein')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Backup person' })).toBeInTheDocument();
  });
});
