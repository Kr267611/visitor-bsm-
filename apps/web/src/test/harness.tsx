import type { SessionUser } from '@visitor/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApiProvider, createWebClient, saveUser, saveTokens, WebClient } from '../api';
import { AppRoutes } from '../app/routes';
import { AuthProvider } from '../auth/AuthProvider';

export type Handler = (req: { body: any; url: URL; init: RequestInit }) => Response | Promise<Response>;
export type Handlers = Record<string, Handler>;

export const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

export interface FakeServer {
  web: WebClient;
  calls: { key: string; body: any; init: RequestInit; url: URL }[];
  /** Lets a test swap handlers midway. */
  handlers: Handlers;
}

/** Real API client with a fake network. Handler keys look like "GET /visits". */
export function fakeServer(handlers: Handlers = {}): FakeServer {
  const calls: FakeServer['calls'] = [];
  const web = createWebClient('http://api.test', (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const key = `${init.method ?? 'GET'} ${url.pathname}`;
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ key, body, init, url });
    const handler = handlers[key];
    if (!handler) return json(404, { error: 'NOT_FOUND', message: `No test handler: ${key}` });
    return handler({ body, url, init });
  }) as unknown as typeof fetch);
  return { web, calls, handlers };
}

export const USERS: Record<string, SessionUser> = {
  admin: { id: 'u-admin', name: 'Admin', role: 'admin', businessId: 'b1' },
  reception: { id: 'u-desk', name: 'Desk', role: 'reception', businessId: 'b1' },
  employee: { id: 'u-emp', name: 'Anita', role: 'employee', businessId: 'b1' },
  guard: { id: 'u-guard', name: 'Guard', role: 'guard', businessId: 'b1' },
  security: { id: 'u-sec', name: 'Security', role: 'security', businessId: 'b1' },
};

export function signIn(user: SessionUser) {
  saveUser(user);
  saveTokens({ accessToken: 'token-1', refreshToken: 'refresh-1' });
}

export function renderApp(route: string, server: FakeServer) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider web={server.web}>
        <MemoryRouter initialEntries={[route]}>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </MemoryRouter>
      </ApiProvider>
    </QueryClientProvider>,
  );
}
