import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeServer, Handlers, json, renderApp, signIn, USERS } from '../test/harness';
import { istToday, toCsv } from './RegisterPage';
import { timeInside } from './GatePassPage';

const pass = (over: object = {}) => ({
  visitId: 'v1',
  gatePassNo: 'GP-2026-00007',
  visitCode: 'VIS-2026-00001',
  status: 'CHECKED_OUT',
  businessName: 'Acme Pvt Ltd',
  premisesName: 'Head Office',
  visitorName: 'Rahul Verma',
  company: 'ABC Traders',
  phone: '+919876543210',
  photoUrl: null,
  hostName: 'Anita Singh',
  purpose: 'Raw material supply',
  purposeNote: 'Yarn lot 12, "urgent"',
  inAt: '2026-11-27T04:45:00.000Z',
  outAt: '2026-11-27T06:10:00.000Z',
  inGate: 'Main Gate 1',
  outGate: 'Main Gate 1',
  itemsOut: '2 sample cones',
  checkedOutBy: null,
  ...over,
});

function server(over: Handlers = {}) {
  return fakeServer({
    'GET /me': () => json(200, { delegateId: null, features: ['dashboard', 'invites'] }),
    'GET /dashboard/live': () => json(200, { inside: [], expected: [], pending: [], needsCall: [] }),
    'GET /gate-passes': () =>
      json(200, [
        pass({ visitId: 'v2', gatePassNo: null, status: 'CHECKED_IN', visitorName: 'Suresh Kumar', outAt: null, itemsOut: null }),
        pass(),
      ]),
    ...over,
  });
}

describe('gate register', () => {
  beforeEach(() => signIn(USERS.admin));

  it('lists who came in today with in, out, time inside, items and the gate pass link', async () => {
    const s = server();
    renderApp('/desk/register', s);
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText('1 h 25 min')).toBeInTheDocument();
    expect(within(rows[1]).getByText('2 sample cones')).toBeInTheDocument();
    expect(within(rows[1]).getByRole('link', { name: 'Gate pass of Rahul Verma' })).toHaveAttribute('href', '/desk/gate-pass/v1');
    expect(within(rows[0]).getByText('Checked in')).toBeInTheDocument();
    expect(screen.getByText('2 came in, 1 still inside')).toBeInTheDocument();

    const first = s.calls.find((c) => c.key === 'GET /gate-passes')!;
    expect(first.url.searchParams.get('from')).toBe(istToday());
    expect(first.url.searchParams.get('to')).toBe(istToday());
  });

  it('changing the dates asks for those days', async () => {
    const s = server();
    renderApp('/desk/register', s);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-11-01' } });
    await waitFor(() => expect(s.calls.some((c) => c.key === 'GET /gate-passes' && c.url.searchParams.get('from') === '2026-11-01')).toBe(true));
  });

  it('is in the Gate desk menu', async () => {
    renderApp('/desk/register', server());
    const menu = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(menu).getByRole('link', { name: 'Gate register' })).toHaveAttribute('href', '/desk/register');
  });

  it('CSV quotes commas and quotes, and Excel reads it as UTF-8', () => {
    const csv = toCsv([pass()] as never);
    expect(csv.startsWith('﻿Gate pass,Visit,Visitor')).toBe(true);
    expect(csv).toContain('"Yarn lot 12, ""urgent"""');
    expect(csv).toContain('1 h 25 min');
    expect(csv.split('\r\n')[1]).toMatch(/^GP-2026-00007,VIS-2026-00001,Rahul Verma,ABC Traders,/);
  });

  it('time inside reads in hours and minutes', () => {
    expect(timeInside('2026-11-27T04:45:00Z', '2026-11-27T05:25:00Z')).toBe('40 min');
    expect(timeInside('2026-11-27T04:45:00Z', '2026-11-27T07:45:00Z')).toBe('3 h 0 min');
    expect(timeInside('2026-11-05T11:14:00Z', '2026-11-27T07:48:00Z')).toBe('21 d 20 h');
    expect(timeInside('2026-11-27T04:45:00Z', null)).toBe('');
  });
});
