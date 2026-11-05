import { ApiClient, ApiError, GateResult, NetworkError, ScanRequest } from '@visitor/shared';

export type ScanOutcome =
  | { kind: 'ok'; data: GateResult }
  | { kind: 'rejected'; error: ApiError }
  | { kind: 'network' };

const MAX_RETRIES = 2;

/** Same clientEventId ke saath retry: server par entry ho chuki ho to bhi doosri nahi banegi. */
export async function scanWithRetry(api: ApiClient, req: ScanRequest, retryDelayMs = 800): Promise<ScanOutcome> {
  for (let attempt = 0; ; attempt++) {
    try {
      return { kind: 'ok', data: await api.gate.scan(req) };
    } catch (error) {
      if (error instanceof ApiError) return { kind: 'rejected', error };
      if (!(error instanceof NetworkError) || attempt >= MAX_RETRIES) return { kind: 'network' };
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}
