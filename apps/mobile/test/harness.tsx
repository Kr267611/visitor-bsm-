import type { SessionUser } from '@visitor/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import { ReactElement } from 'react';
import { ApiProvider, createMobileClient, MobileClient } from '../src/api';
import { AuthProvider } from '../src/auth/AuthProvider';
import { saveSessionUser, secureTokens } from '../src/auth/secureTokens';

export type Handler = (req: { body: any; url: URL; init: RequestInit }) => Response | Promise<Response>;
export type Handlers = Record<string, Handler>;

export const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

export interface FakeServer {
  mobile: MobileClient;
  calls: { key: string; body: any; init: RequestInit }[];
  handlers: Handlers;
}

export function fakeServer(handlers: Handlers = {}): FakeServer {
  const calls: FakeServer['calls'] = [];
  const mobile = createMobileClient('http://api.test', (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const key = `${init.method ?? 'GET'} ${url.pathname}`;
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ key, body, init });
    const handler = handlers[key];
    if (!handler) return json(404, { error: 'NOT_FOUND', message: `Test handler nahi: ${key}` });
    return handler({ body, url, init });
  }) as unknown as typeof fetch);
  return { mobile, calls, handlers };
}

export const USERS: Record<string, SessionUser> = {
  guard: { id: 'u-guard', name: 'Guard', role: 'guard', businessId: 'b1' },
  employee: { id: 'u-emp', name: 'Anita', role: 'employee', businessId: 'b1' },
  admin: { id: 'u-admin', name: 'Admin', role: 'admin', businessId: 'b1' },
  reception: { id: 'u-desk', name: 'Desk', role: 'reception', businessId: 'b1' },
};

export async function signIn(user: SessionUser) {
  await saveSessionUser(user);
  await secureTokens.set({ accessToken: 'token-1', refreshToken: 'refresh-1' });
}

export function renderScreen(ui: ReactElement, server: FakeServer) {
  const queryClient = new QueryClient({
    // gcTime Infinity: cache ke timer test khatam hone ke baad jest ko rokte nahi.
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider mobile={server.mobile}>
        <AuthProvider>{ui}</AuthProvider>
      </ApiProvider>
    </QueryClientProvider>,
  );
}
