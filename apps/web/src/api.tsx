import { ApiClient, ApiError, createApiClient, NetworkError, SessionUser, Tokens } from '@visitor/shared';
import { createContext, ReactNode, useContext } from 'react';

const TOKENS_KEY = 'visitor.tokens';
const USER_KEY = 'visitor.user';
const PREMISES_KEY = 'visitor.premises';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private window mein storage na mile to bhi app chale.
  }
}

export const loadUser = () => read<SessionUser>(USER_KEY);
export const saveUser = (user: SessionUser | null) => write(USER_KEY, user);
export const saveTokens = (tokens: Tokens | null) => write(TOKENS_KEY, tokens);
/** Side menu mein chuna gaya premises; har request par X-Premises-Id. */
export const loadPremisesId = () => read<string>(PREMISES_KEY);
export const savePremisesId = (id: string | null) => write(PREMISES_KEY, id);

export interface WebClient {
  client: ApiClient;
  onSessionExpired(listener: () => void): () => void;
  apiUrl: string;
}

export function createWebClient(baseUrl: string, fetchImpl?: typeof fetch): WebClient {
  const listeners = new Set<() => void>();
  const client = createApiClient({
    baseUrl,
    fetchImpl,
    tokens: {
      get: async () => read<Tokens>(TOKENS_KEY),
      set: async (tokens) => saveTokens(tokens),
    },
    getPremisesId: loadPremisesId,
    onSessionExpired: () => listeners.forEach((listener) => listener()),
  });
  return {
    client,
    apiUrl: baseUrl,
    onSessionExpired(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const accessToken = () => read<Tokens>(TOKENS_KEY)?.accessToken ?? null;

const ApiContext = createContext<WebClient | null>(null);

export function ApiProvider({ web, children }: { web: WebClient; children: ReactNode }) {
  return <ApiContext.Provider value={web}>{children}</ApiContext.Provider>;
}

export function useWebClient(): WebClient {
  const web = useContext(ApiContext);
  if (!web) throw new Error('ApiProvider missing');
  return web;
}

export const useApi = (): ApiClient => useWebClient().client;

/** Har error ka user ko dikhne wala message. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof NetworkError) return error.message;
  return 'Kuch gadbad ho gayi. Dobara koshish karein.';
}
