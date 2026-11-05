import type { VisitStatus } from './status';
import type { ErrorCode, LiveDashboard, Role, VisitSummary } from './types';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export interface SessionUser {
  id: string;
  name: string;
  role: Role;
  siteId: string | null;
}

export interface Session extends Tokens {
  user: SessionUser;
  deviceId: string;
}

export interface VisitDetail extends VisitSummary {
  purpose: string;
  hostId: string;
  type: 'PRE' | 'WALKIN';
  decisionNote: string | null;
  deliveryFailed: boolean;
  receptionCallRequestedAt: string | null;
}

export interface ScanRequest {
  qr: string;
  gateId: string;
  mode: 'IN' | 'OUT';
  clientEventId: string;
}

export interface GateResult {
  result: 'CHECKED_IN' | 'CHECKED_OUT';
  visitId: string;
  visitor: { name: string; company: string | null; photoUrl: string | null };
  host: string;
  validTo: string;
}

export interface WalkInRequest {
  phone: string;
  otp: string;
  name: string;
  company?: string;
  photoKey?: string;
  hostId: string;
  purpose: string;
  gateId: string;
  consent: boolean;
  clientEventId: string;
}

export interface PublicInvite {
  status: VisitStatus;
  visitorName: string;
  hostName: string;
  siteName: string;
  validFrom: string;
  validTo: string;
  pass: string | null;
}

export interface InviteRequest {
  visitorName: string;
  visitorPhone: string;
  validFrom: string;
  validTo: string;
  purpose: string;
}

export interface RegisterRequest {
  name: string;
  company?: string;
  photoKey: string;
  idType?: string;
  idLast4?: string;
  consent: boolean;
}

export interface Gate {
  id: string;
  name: string;
  siteId: string;
  isActive?: boolean;
}

export interface Site {
  id: string;
  name: string;
  address: string | null;
}

export interface AdminUser {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  role: Role;
  department: string | null;
  siteId: string | null;
  isActive: boolean;
}

export interface Profile extends AdminUser {
  delegateId: string | null;
  delegateName: string | null;
}

export interface AdminDevice {
  id: string;
  name: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  user: { id: string; name: string; role: Role };
}

/** Browser mein Blob, React Native mein `{ uri, name, type }`. */
export type PhotoFile = Blob | { uri: string; name: string; type: string };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly body: Record<string, any>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Server tak pahunch hi nahi paye. Entry hui ya nahi, pata nahi. */
export class NetworkError extends Error {
  constructor(message = 'Internet ya server se connection nahi ho paya.') {
    super(message);
    this.name = 'NetworkError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  tokens: { get(): Promise<Tokens | null>; set(tokens: Tokens | null): Promise<void> };
  onSessionExpired(): void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

interface RequestOptions {
  body?: unknown;
  form?: FormData;
  /** Login ke bina wale routes. */
  anonymous?: boolean;
}

function queryString(params: Record<string, string | undefined>): string {
  const pairs = Object.entries(params).filter((e): e is [string, string] => !!e[1]);
  return pairs.length ? `?${pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}` : '';
}

function photoForm(file: PhotoFile): FormData {
  const form = new FormData();
  form.append('photo', file as Blob, 'photo.jpg');
  return form;
}

export function createApiClient(options: ApiClientOptions) {
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let refreshing: Promise<void> | null = null;

  async function send(method: string, path: string, opts: RequestOptions, accessToken?: string): Promise<Response> {
    const headers: Record<string, string> = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(`${options.baseUrl}${path}`, {
        method,
        headers,
        body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
        signal: controller.signal,
      });
    } catch {
      throw new NetworkError();
    } finally {
      clearTimeout(timer);
    }
  }

  async function parse<T>(res: Response): Promise<T> {
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let body: any;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
    if (!res.ok) {
      throw new ApiError(
        res.status,
        body.error ?? 'INTERNAL',
        body.message ?? 'Kuch gadbad ho gayi. Dobara koshish karein.',
        body,
      );
    }
    return body as T;
  }

  /** Ek saath kitni bhi requests 401 payein, refresh ek hi baar hota hai. */
  function refresh(): Promise<void> {
    refreshing ??= (async () => {
      try {
        const current = await options.tokens.get();
        if (!current) throw new ApiError(401, 'UNAUTHORIZED', 'Dobara login karein.', {});
        const res = await send('POST', '/auth/refresh', { body: { refreshToken: current.refreshToken } });
        await options.tokens.set(await parse<Tokens>(res));
      } catch (error) {
        // Sirf server ke saaf "login galat hai" par hatao. Internet ya server ki dikkat par nahi.
        if (error instanceof ApiError && error.status === 401) {
          await options.tokens.set(null);
          options.onSessionExpired();
        }
        throw error;
      }
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    if (opts.anonymous) return parse<T>(await send(method, path, opts));

    const tokens = await options.tokens.get();
    const res = await send(method, path, opts, tokens?.accessToken);
    if (res.status !== 401) return parse<T>(res);

    // Sirf login expire hone par refresh. Visitor ka galat OTP bhi 401 hai, usse guard logout nahi hona chahiye.
    const code = await res
      .clone()
      .json()
      .then((body) => (body as { error?: string }).error)
      .catch(() => undefined);
    if (code && code !== 'UNAUTHORIZED') return parse<T>(res);

    await refresh();
    const next = await options.tokens.get();
    return parse<T>(await send(method, path, opts, next?.accessToken));
  }

  const crud = <Row>(path: string) => ({
    list: () => request<Row[]>('GET', path),
    create: (body: object) => request<Row>('POST', path, { body }),
    update: (id: string, body: object) => request<Row>('PATCH', `${path}/${id}`, { body }),
  });

  return {
    auth: {
      requestOtp: (phone: string) =>
        request<void>('POST', '/auth/otp/request', { body: { phone }, anonymous: true }),
      verifyOtp: async (body: { phone: string; otp: string; deviceName: string }) => {
        const session = await request<Session>('POST', '/auth/otp/verify', { body, anonymous: true });
        await options.tokens.set({ accessToken: session.accessToken, refreshToken: session.refreshToken });
        return session;
      },
      logout: async () => {
        const tokens = await options.tokens.get();
        await options.tokens.set(null);
        if (tokens) {
          await request<void>('POST', '/auth/logout', {
            body: { refreshToken: tokens.refreshToken },
            anonymous: true,
          });
        }
      },
    },
    me: {
      get: () => request<Profile>('GET', '/me'),
      update: (body: { delegateId: string | null }) => request<Profile>('PATCH', '/me', { body }),
    },
    devices: {
      savePushToken: (pushToken: string) => request<void>('POST', '/devices/push-token', { body: { pushToken } }),
    },
    gates: { list: () => request<Gate[]>('GET', '/gates') },
    users: {
      searchHosts: (q: string) =>
        request<{ id: string; name: string; department: string | null }[]>(
          'GET',
          `/users/hosts${queryString({ q })}`,
        ),
    },
    visits: {
      create: (body: InviteRequest) =>
        request<{ id: string; code: string; status: VisitStatus }>('POST', '/visits', { body }),
      list: (q: { scope?: 'mine' | 'site'; date?: string; status?: VisitStatus } = {}) =>
        request<VisitSummary[]>('GET', `/visits${queryString(q)}`),
      get: (id: string) => request<VisitDetail>('GET', `/visits/${id}`),
      cancel: (id: string) => request<{ id: string; status: VisitStatus }>('POST', `/visits/${id}/cancel`),
      resendInvite: (id: string) => request<void>('POST', `/visits/${id}/resend-invite`),
      approve: (id: string, note?: string) =>
        request<{ id: string; status: VisitStatus }>('POST', `/visits/${id}/approve`, { body: { note } }),
      reject: (id: string, reason?: string) =>
        request<{ id: string; status: VisitStatus }>('POST', `/visits/${id}/reject`, { body: { reason } }),
      checkIn: (id: string, body: { gateId: string; clientEventId: string }) =>
        request<GateResult>('POST', `/visits/${id}/check-in`, { body }),
      checkOut: (id: string, body: { gateId: string; clientEventId: string }) =>
        request<GateResult>('POST', `/visits/${id}/check-out`, { body }),
    },
    gate: {
      scan: (body: ScanRequest) => request<GateResult>('POST', '/gate/scan', { body }),
      visitorLookup: (phone: string) =>
        request<{ found: boolean; name?: string; company?: string | null; photoUrl?: string | null }>(
          'GET',
          `/gate/visitors/lookup${queryString({ phone })}`,
        ),
      walkInOtp: (phone: string) => request<void>('POST', '/gate/walk-ins/otp', { body: { phone } }),
      walkIn: (body: WalkInRequest) =>
        request<{ visitId: string; code: string; status: VisitStatus }>('POST', '/gate/walk-ins', { body }),
    },
    uploads: {
      uploadPhoto: (file: PhotoFile) =>
        request<{ key: string }>('POST', '/uploads/photo', { form: photoForm(file) }),
    },
    publicInvites: {
      get: (token: string) => request<PublicInvite>('GET', `/public/invites/${token}`, { anonymous: true }),
      uploadPhoto: (token: string, file: PhotoFile) =>
        request<{ key: string }>('POST', `/public/invites/${token}/photo`, { form: photoForm(file), anonymous: true }),
      register: (token: string, body: RegisterRequest) =>
        request<PublicInvite>('POST', `/public/invites/${token}/register`, { body, anonymous: true }),
    },
    dashboard: { live: () => request<LiveDashboard>('GET', '/dashboard/live') },
    admin: {
      users: crud<AdminUser>('/admin/users'),
      sites: crud<Site>('/admin/sites'),
      gates: crud<Gate>('/admin/gates'),
      devices: {
        list: () => request<AdminDevice[]>('GET', '/admin/devices'),
        revoke: (id: string) => request<void>('POST', `/admin/devices/${id}/revoke`),
      },
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
