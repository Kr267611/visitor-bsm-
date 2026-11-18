import { AsyncLocalStorage } from 'node:async_hooks';

/** Ek request (ya job) kis business ke liye chal rahi hai. */
export interface RequestContext {
  businessId: string | null;
  userId?: string;
  role?: string;
  premisesIds: string[];
  activePremisesId: string | null;
  /** true = jobs, login lookups jaise kaam jo saare businesses dekh sakte hain. */
  system: boolean;
}

const storage = new AsyncLocalStorage<RequestContext>();

function empty(): RequestContext {
  return { businessId: null, premisesIds: [], activePremisesId: null, system: false };
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

/** HTTP request ko khaali context mein chalata hai; guard login ke baad isey bharta hai. */
export function runInEmptyContext<T>(fn: () => T): T {
  return storage.run(empty(), fn);
}

/**
 * Ek business ke andar chalao: scoped client sirf iska data dekhega.
 * Andar hi await hota hai, kyunki Prisma query await par chalti hai; bahar await hoti to context kho jata.
 */
export function runInTenant<T>(
  businessId: string,
  fn: () => T | PromiseLike<T>,
  extra: Partial<RequestContext> = {},
): Promise<T> {
  return storage.run({ ...empty(), ...extra, businessId, system: false }, async () => await fn());
}

/** Jobs aur auth lookups ke liye: business filter nahi lagta. Soch samajh kar use karein. */
export function runAsSystem<T>(fn: () => T | PromiseLike<T>): Promise<T> {
  return storage.run({ ...empty(), system: true }, async () => await fn());
}

/** Login ke baad guard current request ka context bharta hai. */
export function fillContext(patch: Partial<RequestContext>): void {
  const store = storage.getStore();
  if (store) Object.assign(store, patch);
}

/** Current business ka id; context na ho to throw (fail closed). Create mein `businessId: tenantId()`. */
export function tenantId(): string {
  const id = storage.getStore()?.businessId;
  if (!id) throw new Error('Tenant context missing');
  return id;
}
