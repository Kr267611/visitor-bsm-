import { AsyncLocalStorage } from 'node:async_hooks';

/** Which business a request (or job) is running for. */
export interface RequestContext {
  businessId: string | null;
  userId?: string;
  role?: string;
  premisesIds: string[];
  activePremisesId: string | null;
  /** true = work such as jobs and sign-in lookups that may see every business. */
  system: boolean;
}

const storage = new AsyncLocalStorage<RequestContext>();

function empty(): RequestContext {
  return { businessId: null, premisesIds: [], activePremisesId: null, system: false };
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Runs an HTTP request in an empty context; the guard fills it after sign-in. */
export function runInEmptyContext<T>(fn: () => T): T {
  return storage.run(empty(), fn);
}

/**
 * Run inside one business: the scoped client sees only its data.
 * Awaited inside, because a Prisma query runs when awaited; awaiting outside would lose the context.
 */
export function runInTenant<T>(
  businessId: string,
  fn: () => T | PromiseLike<T>,
  extra: Partial<RequestContext> = {},
): Promise<T> {
  return storage.run({ ...empty(), ...extra, businessId, system: false }, async () => await fn());
}

/** For jobs and sign-in lookups: no business filter. Use with care. */
export function runAsSystem<T>(fn: () => T | PromiseLike<T>): Promise<T> {
  return storage.run({ ...empty(), system: true }, async () => await fn());
}

/** After sign-in the guard fills the current request's context. */
export function fillContext(patch: Partial<RequestContext>): void {
  const store = storage.getStore();
  if (store) Object.assign(store, patch);
}

/** Current business id; throws when there is no context (fail closed). Use `businessId: tenantId()` in creates. */
export function tenantId(): string {
  const id = storage.getStore()?.businessId;
  if (!id) throw new Error('Tenant context missing');
  return id;
}
