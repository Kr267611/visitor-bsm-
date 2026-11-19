import { Prisma, PrismaClient } from '@prisma/client';
import { currentContext } from './request-context';

/** Tables with business_id. Every query on them is limited to the business automatically. */
export const TENANT_MODELS = new Set<string>([
  'Premises',
  'PremisesSetting',
  'Department',
  'Designation',
  'UserPremises',
  'AuditLog',
  'Gate',
  'User',
  'Visitor',
  'Visit',
  'VisitEvent',
  'Outbox',
]);

export const TENANT_PRISMA = Symbol('TENANT_PRISMA');

/** Models that have a `business` relation field (the rest only have a businessId column). */
const HAS_BUSINESS_RELATION = new Set(
  Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === 'business' && f.kind === 'object')).map((m) => m.name),
);

export class TenantContextMissingError extends Error {
  constructor(model: string, operation: string) {
    super(`Tenant context missing (${model}.${operation})`);
  }
}

const WHERE_OPS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'updateManyAndReturn',
  'deleteMany',
]);
const UNIQUE_OPS = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete', 'upsert']);
const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn']);

type Data = Record<string, unknown>;

/** With nested relation writes (connect/create) the business must also be set through the relation. */
function usesRelationWrites(data: Data): boolean {
  return Object.values(data).some(
    (v) =>
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      !(v instanceof Date) &&
      ('connect' in v || 'connectOrCreate' in v || 'create' in v),
  );
}

function withBusiness(data: Data, businessId: string, model: string): Data {
  if ('businessId' in data) {
    if (data.businessId !== businessId) throw new Error(`${model}: writing into another business is not allowed`);
    return data;
  }
  if ('business' in data) {
    const id = (data.business as { connect?: { id?: string } })?.connect?.id;
    if (id !== businessId) throw new Error(`${model}: writing into another business is not allowed`);
    return data;
  }
  return HAS_BUSINESS_RELATION.has(model) && usesRelationWrites(data) ? { ...data, business: { connect: { id: businessId } } } : { ...data, businessId };
}

function andBusiness(where: unknown, businessId: string) {
  return where ? { AND: [where, { businessId }] } : { businessId };
}

/** Scoped client on top of the raw client: adds the context's business to every query, throws without a context. */
export function createTenantClient(prisma: PrismaClient) {
  return prisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);
          const ctx = currentContext();
          if (ctx?.system) return query(args);
          const businessId = ctx?.businessId;
          if (!businessId) throw new TenantContextMissingError(model, operation);

          const a = { ...(args as Record<string, unknown>) };
          if (WHERE_OPS.has(operation)) {
            a.where = andBusiness(a.where, businessId);
          } else if (UNIQUE_OPS.has(operation)) {
            // Prisma 5+: extra filters are allowed alongside a unique where.
            a.where = { ...(a.where as Data), businessId };
            if (operation === 'upsert') a.create = withBusiness(a.create as Data, businessId, model);
          } else if (CREATE_OPS.has(operation)) {
            a.data = Array.isArray(a.data)
              ? a.data.map((d: Data) => withBusiness(d, businessId, model))
              : withBusiness(a.data as Data, businessId, model);
          }
          if ((operation === 'update' || operation === 'updateMany' || operation === 'upsert') && a.data) {
            assertNotMoving(a.data as Data, businessId, model);
          }
          if (operation === 'upsert' && a.update) assertNotMoving(a.update as Data, businessId, model);
          return query(a as typeof args);
        },
      },
    },
  });
}

/** An update must never move a row into another business. */
function assertNotMoving(data: Data, businessId: string, model: string) {
  if ('businessId' in data && data.businessId !== businessId) {
    throw new Error(`${model}: changing the business is not allowed`);
  }
  if ('business' in data) throw new Error(`${model}: changing the business relation is not allowed`);
}

export type TenantPrismaClient = ReturnType<typeof createTenantClient>;
/** Client inside an interactive transaction of the scoped client. */
export type TenantTx = Omit<TenantPrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;
export type { Prisma };
