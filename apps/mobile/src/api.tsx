import { ApiClient, ApiError, createApiClient, NetworkError } from '@visitor/shared';
import { createContext, ReactNode, useContext } from 'react';
import { secureTokens } from './auth/secureTokens';

export interface MobileClient {
  client: ApiClient;
  apiUrl: string;
  onSessionExpired(listener: () => void): () => void;
}

export function createMobileClient(baseUrl: string, fetchImpl?: typeof fetch): MobileClient {
  const listeners = new Set<() => void>();
  return {
    apiUrl: baseUrl,
    client: createApiClient({
      baseUrl,
      fetchImpl,
      tokens: secureTokens,
      onSessionExpired: () => listeners.forEach((listener) => listener()),
    }),
    onSessionExpired(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const ApiContext = createContext<MobileClient | null>(null);

export function ApiProvider({ mobile, children }: { mobile: MobileClient; children: ReactNode }) {
  return <ApiContext.Provider value={mobile}>{children}</ApiContext.Provider>;
}

export function useMobileClient(): MobileClient {
  const mobile = useContext(ApiContext);
  if (!mobile) throw new Error('ApiProvider missing');
  return mobile;
}

export const useApi = (): ApiClient => useMobileClient().client;

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof NetworkError) return error.message;
  return 'Something went wrong. Please try again.';
}
