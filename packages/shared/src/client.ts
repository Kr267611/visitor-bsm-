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
  /** null for a super admin. */
  businessId: string | null;
}

/** When one phone/email exists in several businesses, this list arrives after the password/OTP is verified. */
export interface BusinessChoice {
  selectionToken: string;
  businesses: { id: string | null; name: string }[];
}

/** Business list when sign-in answered 409 CHOOSE_BUSINESS, otherwise null. */
export function businessChoice(error: unknown): BusinessChoice | null {
  if (!(error instanceof ApiError) || error.code !== 'CHOOSE_BUSINESS') return null;
  return { selectionToken: error.body.selectionToken, businesses: error.body.businesses ?? [] };
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
  premisesId: string;
  isActive?: boolean;
}

export type PremisesCategory = 'business' | 'events' | 'exhibition';

export interface Premises {
  id: string;
  name: string;
  address: string | null;
  mobile: string | null;
  email: string | null;
  lat: number | null;
  lng: number | null;
  geofenceM: number | null;
  category: PremisesCategory;
  /** 6-character code a kiosk uses to identify its premises. */
  code: string;
  webSlug: string;
  isDefault: boolean;
  purposes: string[];
}

export interface PremisesInput {
  name: string;
  address?: string;
  mobile?: string;
  email?: string;
  category?: PremisesCategory;
  purposes?: string[];
  isDefault?: boolean;
}

export interface PremisesSettings {
  premisesId: string;
  visitStart: string | null;
  visitEnd: string | null;
  checkinOnApproval: boolean;
  onlyCheckin: boolean;
  autoCheckoutHrs: number | null;
  overstayMin: number | null;
  waitingMin: number | null;
  defaultVisitMin: number;
  slotMin: number;
  delayAlertMin: number | null;
  onlyMemberCheckin: boolean;
  reportEmails: string[];
  reportSchedule: 'daily' | 'weekly' | 'monthly' | null;
  googleReviewUrl: string | null;
}

export interface Department {
  id: string;
  name: string;
  memberCount?: number;
}

export interface AdminUser {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  role: Role;
  departmentId: string | null;
  designation: string | null;
  joiningDate: string | null;
  isHost: boolean;
  isActive: boolean;
  premisesIds: string[];
}

export interface MemberInput {
  name: string;
  phone: string;
  role: Role;
  premisesIds: string[];
  email?: string;
  departmentId?: string | null;
  designation?: string;
  isHost?: boolean;
  isActive?: boolean;
  password?: string;
}

export interface AuditEntry {
  id: string;
  actorId: string | null;
  entity: string;
  entityId: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  at: string;
}

export interface Profile extends AdminUser {
  delegateId: string | null;
  delegateName: string | null;
  business: { id: string; name: string; slug: string } | null;
  premises: { id: string; name: string; isDefault: boolean }[];
  activePremisesId: string | null;
  /** Modules in the business plan; the menu is built from these. */
  features: string[];
}

export interface AdminDevice {
  id: string;
  name: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  user: { id: string; name: string; role: Role };
}

/** A Blob in the browser, `{ uri, name, type }` in React Native. */
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

/** The server could not be reached. Whether the entry was recorded is unknown. */
export class NetworkError extends Error {
  constructor(message = 'Could not reach the server. Check your internet connection.') {
    super(message);
    this.name = 'NetworkError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  tokens: { get(): Promise<Tokens | null>; set(tokens: Tokens | null): Promise<void> };
  onSessionExpired(): void;
  /** Selected premises: sent as the `X-Premises-Id` header on signed-in requests. Without it the server uses the default. */
  getPremisesId?: () => string | null | Promise<string | null>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

interface RequestOptions {
  body?: unknown;
  form?: FormData;
  /** Routes that work without sign-in. */
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
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
      const premisesId = await options.getPremisesId?.();
      if (premisesId) headers['X-Premises-Id'] = premisesId;
    }
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
        body.message ?? 'Something went wrong. Please try again.',
        body,
      );
    }
    return body as T;
  }

  /** However many requests get a 401 at once, the refresh happens only once. */
  function refresh(): Promise<void> {
    refreshing ??= (async () => {
      try {
        const current = await options.tokens.get();
        if (!current) throw new ApiError(401, 'UNAUTHORIZED', 'Please sign in again.', {});
        const res = await send('POST', '/auth/refresh', { body: { refreshToken: current.refreshToken } });
        await options.tokens.set(await parse<Tokens>(res));
      } catch (error) {
        // Clear the session only when the server clearly rejects it, never on network or server trouble.
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

    // Refresh only when the session expired. A visitor's wrong OTP is also a 401 and must not sign the guard out.
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

  const crud = <Row, Input extends object = object>(path: string) => ({
    list: () => request<Row[]>('GET', path),
    create: (body: Input) => request<Row>('POST', path, { body }),
    update: (id: string, body: Partial<Input>) => request<Row>('PATCH', `${path}/${id}`, { body }),
  });

  /** Saves tokens when a session arrives. CHOOSE_BUSINESS throws an ApiError (see `businessChoice`). */
  async function startSession(path: string, body: object): Promise<Session> {
    const session = await request<Session>('POST', path, { body, anonymous: true });
    await options.tokens.set({ accessToken: session.accessToken, refreshToken: session.refreshToken });
    return session;
  }

  return {
    auth: {
      requestOtp: (phone: string) =>
        request<void>('POST', '/auth/otp/request', { body: { phone }, anonymous: true }),
      verifyOtp: (body: { phone: string; otp: string; deviceName: string }) => startSession('/auth/otp/verify', body),
      /** Phone ya email + password. */
      login: (body: { identifier: string; password: string; deviceName: string }) => startSession('/auth/login', body),
      selectBusiness: (body: { selectionToken: string; businessId: string | null; deviceName: string }) =>
        startSession('/auth/select-business', body),
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
      changePassword: (body: { currentPassword?: string; newPassword: string }) =>
        request<void>('PUT', '/me/password', { body }),
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
      users: {
        ...crud<AdminUser, MemberInput>('/admin/users'),
        search: (q: string) => request<AdminUser[]>('GET', `/admin/users${queryString({ q })}`),
        resetPassword: (id: string, password: string) =>
          request<void>('PUT', `/admin/users/${id}/password`, { body: { password } }),
      },
      premises: {
        ...crud<Premises, PremisesInput>('/admin/premises'),
        settings: (id: string) => request<PremisesSettings>('GET', `/admin/premises/${id}/settings`),
        updateSettings: (id: string, body: Partial<Omit<PremisesSettings, 'premisesId'>>) =>
          request<PremisesSettings>('PUT', `/admin/premises/${id}/settings`, { body }),
      },
      gates: crud<Gate, { premisesId: string; name: string; isActive?: boolean }>('/admin/gates'),
      departments: {
        ...crud<Department, { name: string }>('/admin/departments'),
        remove: (id: string) => request<void>('DELETE', `/admin/departments/${id}`),
      },
      audit: (q: { entity?: string; entityId?: string } = {}) =>
        request<AuditEntry[]>('GET', `/admin/audit${queryString(q)}`),
      devices: {
        list: () => request<AdminDevice[]>('GET', '/admin/devices'),
        revoke: (id: string) => request<void>('POST', `/admin/devices/${id}/revoke`),
      },
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
