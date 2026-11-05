import { ApiError, createApiClient, NetworkError, Tokens } from './client';

function json(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

function setup(handler: (url: string, init: RequestInit) => Promise<Response> | Response, timeoutMs?: number) {
  let stored: Tokens | null = { accessToken: 'old-access', refreshToken: 'old-refresh' };
  const calls: { url: string; init: RequestInit }[] = [];
  let expired = 0;
  const api = createApiClient({
    baseUrl: 'http://api.test',
    timeoutMs,
    tokens: {
      get: async () => stored,
      set: async (t) => {
        stored = t;
      },
    },
    onSessionExpired: () => {
      expired += 1;
    },
    fetchImpl: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return handler(url, init);
    }) as unknown as typeof fetch,
  });
  return { api, calls, stored: () => stored, expiredCount: () => expired };
}

const authHeader = (init: RequestInit) => (init.headers as Record<string, string>).Authorization;

describe('createApiClient', () => {
  it('adds bearer token', async () => {
    const t = setup(() => json(200, []));
    await t.api.gates.list();
    expect(t.calls[0].url).toBe('http://api.test/gates');
    expect(authHeader(t.calls[0].init)).toBe('Bearer old-access');
  });

  it('public routes send no token', async () => {
    const t = setup(() => json(200, { status: 'INVITED' }));
    await t.api.publicInvites.get('abc');
    expect(authHeader(t.calls[0].init)).toBeUndefined();
  });

  it('401 refreshes once and retries', async () => {
    const t = setup((url, init) => {
      if (url.endsWith('/auth/refresh')) return json(200, { accessToken: 'new-access', refreshToken: 'new-refresh' });
      return authHeader(init) === 'Bearer new-access' ? json(200, [{ id: 'g' }]) : json(401, { error: 'UNAUTHORIZED', message: 'x' });
    });
    expect(await t.api.gates.list()).toEqual([{ id: 'g' }]);
    expect(t.calls.map((c) => c.url.replace('http://api.test', ''))).toEqual(['/gates', '/auth/refresh', '/gates']);
    expect(t.stored()).toEqual({ accessToken: 'new-access', refreshToken: 'new-refresh' });
  });

  it('5 parallel 401s trigger one refresh', async () => {
    const t = setup(async (url, init) => {
      if (url.endsWith('/auth/refresh')) {
        await new Promise((r) => setTimeout(r, 20));
        return json(200, { accessToken: 'new-access', refreshToken: 'new-refresh' });
      }
      return authHeader(init) === 'Bearer new-access' ? json(200, []) : json(401, { error: 'UNAUTHORIZED', message: 'x' });
    });
    await Promise.all([1, 2, 3, 4, 5].map(() => t.api.gates.list()));
    expect(t.calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('refresh failure clears tokens, calls onSessionExpired', async () => {
    const t = setup(() => json(401, { error: 'UNAUTHORIZED', message: 'Dobara login karein.' }));
    await expect(t.api.gates.list()).rejects.toBeInstanceOf(ApiError);
    expect(t.stored()).toBeNull();
    expect(t.expiredCount()).toBe(1);
  });

  it('network failure during refresh keeps the session', async () => {
    const t = setup((url) => {
      if (url.endsWith('/auth/refresh')) throw new TypeError('offline');
      return json(401, { error: 'UNAUTHORIZED', message: 'x' });
    });
    await expect(t.api.gates.list()).rejects.toBeInstanceOf(NetworkError);
    expect(t.stored()).not.toBeNull();
    expect(t.expiredCount()).toBe(0);
  });

  it('wrong OTP 401 does not trigger refresh', async () => {
    const t = setup(() => json(401, { error: 'INVALID_OTP', message: 'OTP sahi nahi hai.' }));
    await expect(t.api.auth.verifyOtp({ phone: 'p', otp: '1', deviceName: 'd' })).rejects.toMatchObject({ code: 'INVALID_OTP' });
    expect(t.calls).toHaveLength(1);
    expect(t.expiredCount()).toBe(0);
  });

  it('wrong visitor OTP on a logged-in route keeps the session', async () => {
    const t = setup(() => json(401, { error: 'INVALID_OTP', message: 'OTP sahi nahi hai.' }));
    const err = await t.api.gate
      .walkIn({
        phone: 'p',
        otp: '1',
        name: 'n',
        hostId: 'h',
        purpose: 'x',
        gateId: 'g',
        consent: true,
        clientEventId: 'c',
      })
      .catch((e) => e);
    expect(err.code).toBe('INVALID_OTP');
    expect(t.calls).toHaveLength(1);
    expect(t.stored()).not.toBeNull();
    expect(t.expiredCount()).toBe(0);
  });

  it('error body becomes ApiError with code', async () => {
    const t = setup(() => json(409, { error: 'ALREADY_CHECKED_IN', message: 'Andar hain', gate: 'Gate 1' }));
    const err = await t.api.gate.scan({ qr: 'q', gateId: 'g', mode: 'IN', clientEventId: 'c' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.code).toBe('ALREADY_CHECKED_IN');
    expect(err.message).toBe('Andar hain');
    expect(err.body.gate).toBe('Gate 1');
  });

  it('non-JSON error body still gives ApiError', async () => {
    const t = setup(() => new Response('<html>bad gateway</html>', { status: 502 }));
    const err = await t.api.gates.list().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.code).toBe('INTERNAL');
  });

  it('fetch rejection becomes NetworkError', async () => {
    const t = setup(() => {
      throw new TypeError('offline');
    });
    await expect(t.api.gates.list()).rejects.toBeInstanceOf(NetworkError);
  });

  it('timeout becomes NetworkError', async () => {
    const t = setup(
      (_url, init) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
      10,
    );
    await expect(t.api.gates.list()).rejects.toBeInstanceOf(NetworkError);
  });

  it('204 resolves undefined', async () => {
    const t = setup(() => new Response(null, { status: 204 }));
    await expect(t.api.auth.requestOtp('9876543210')).resolves.toBeUndefined();
  });

  it('verifyOtp stores tokens, logout clears them', async () => {
    const t = setup((url) =>
      url.endsWith('/auth/logout')
        ? new Response(null, { status: 204 })
        : json(200, { accessToken: 'a', refreshToken: 'r', user: { id: 'u' }, deviceId: 'd' }),
    );
    await t.api.auth.verifyOtp({ phone: 'p', otp: '123456', deviceName: 'd' });
    expect(t.stored()).toEqual({ accessToken: 'a', refreshToken: 'r' });
    await t.api.auth.logout();
    expect(t.stored()).toBeNull();
  });

  it('list encodes query, leaves out empty values', async () => {
    const t = setup(() => json(200, []));
    await t.api.visits.list({ scope: 'site', date: '2026-11-05' });
    expect(t.calls[0].url).toBe('http://api.test/visits?scope=site&date=2026-11-05');
  });
});
