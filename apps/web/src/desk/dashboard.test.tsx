import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeServer, Handlers, json, renderApp, signIn, USERS } from '../test/harness';

const visit = (over: object = {}) => ({
  id: 'v1',
  code: 'VIS-1',
  status: 'CHECKED_IN',
  visitorName: 'Rahul Verma',
  company: 'ABC Traders',
  photoUrl: null,
  hostName: 'Anita Singh',
  validFrom: '2026-11-20T04:30:00.000Z',
  validTo: '2026-11-20T08:30:00.000Z',
  checkedInAt: '2026-11-20T05:30:00.000Z',
  purpose: 'Yarn delivery',
  purposeNote: null,
  deliveryFailed: false,
  ...over,
});

const stats = (period = 'month') => ({
  visits: { today: 3, month: 49, total: 1986 },
  invites: { today: 0, month: 4, total: 120 },
  walkIns: { today: 2, month: 30, total: 900 },
  rejected: { today: 0, month: 1, total: 12 },
  totalVisitors: 959,
  insideNow: 2,
  waitingNow: 1,
  hostWise:
    period === 'today'
      ? [{ name: 'Anita Singh', count: 1 }]
      : [
          { name: 'Anita Singh', count: 20 },
          { name: 'Reception desk', count: 9 },
        ],
  period,
  monthWise: [0, 0, 0, 0, 160, 290, 210, 340, 110, 830, 49, 0],
  year: 2026,
  todayVisits: [visit(), visit({ id: 'v2', status: 'PENDING_APPROVAL', visitorName: 'Suresh Kumar', company: null, hostName: 'Reception desk', checkedInAt: null })],
});

function server(over: Handlers = {}) {
  return fakeServer({
    'GET /me': () => json(200, { delegateId: null, features: ['dashboard', 'invites'] }),
    'GET /dashboard/live': () => json(200, { inside: [], expected: [], pending: [], needsCall: [] }),
    'GET /dashboard/stats': ({ url }) => json(200, stats(url.searchParams.get('period') ?? 'month')),
    ...over,
  });
}

describe('dashboard', () => {
  beforeEach(() => signIn(USERS.admin));

  it('shows the cards, both charts and today’s visitors', async () => {
    renderApp('/dashboard', server());
    const visits = await screen.findByRole('region', { name: 'Visits' });
    expect(within(visits).getByText('3')).toBeInTheDocument();
    expect(within(visits).getByText('49')).toBeInTheDocument();
    expect(within(visits).getByText('1,986')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Total visitors' })).getByText('959')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Inside now' })).getByRole('link', { name: '1 waiting for approval' })).toHaveAttribute(
      'href',
      '/desk/pending',
    );

    const hosts = screen.getByRole('list', { name: 'Visits per host' });
    expect(within(hosts).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Anita Singh20', 'Reception desk9']);
    const months = screen.getByRole('list', { name: 'Visits per month in 2026' });
    expect(within(months).getByRole('listitem', { name: 'Oct: 830 visits' })).toBeInTheDocument();

    const today = screen.getByRole('region', { name: "Today's visitors" });
    expect(within(today).getByText('Rahul Verma')).toBeInTheDocument();
    expect(within(today).getByText('Suresh Kumar')).toBeInTheDocument();
  });

  it('host-wise chart follows the chosen period', async () => {
    const s = server();
    renderApp('/dashboard', s);
    const user = userEvent.setup();
    await screen.findByRole('list', { name: 'Visits per host' });
    await user.selectOptions(screen.getByLabelText('Period'), 'today');
    await waitFor(() =>
      expect(within(screen.getByRole('list', { name: 'Visits per host' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
        'Anita Singh1',
      ]),
    );
  });

  it('admins land on the dashboard and see it first in the menu', async () => {
    renderApp('/', server());
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    const menu = screen.getByRole('navigation', { name: 'Main' });
    expect(within(menu).getAllByRole('link')[0]).toHaveTextContent('Dashboard');
  });

  it('a guard has no dashboard', async () => {
    signIn(USERS.guard);
    renderApp('/dashboard', server());
    expect(await screen.findByText(/You do not have access to this page/)).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Main' })).queryByRole('link', { name: 'Dashboard' })).toBeNull();
  });
});
