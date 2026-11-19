import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer, json, renderApp, signIn, USERS } from '../test/harness';

describe('Day / Night switch', () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
    localStorage.removeItem('theme');
  });

  it('switches to Night and back, and remembers the choice on this device', async () => {
    renderApp('/login', fakeServer());
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Switch to night mode' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to day mode' })).toHaveTextContent('Night');
    await user.click(screen.getByRole('button', { name: 'Switch to day mode' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('is in the side menu after sign-in and starts from the saved choice', async () => {
    document.documentElement.dataset.theme = 'dark';
    signIn(USERS.guard);
    renderApp(
      '/desk/inside',
      fakeServer({
        'GET /dashboard/live': () => json(200, { pending: [], needsCall: [], expected: [], inside: [] }),
        'GET /gates': () => json(200, []),
        'GET /me': () => json(200, { delegateId: null, modules: ['desk'], features: ['dashboard'] }),
      }),
    );
    const toggles = await screen.findAllByRole('button', { name: 'Switch to day mode' });
    expect(toggles.length).toBeGreaterThan(0);
  });
});
