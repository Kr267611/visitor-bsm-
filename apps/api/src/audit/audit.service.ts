import { Prisma } from '@prisma/client';
import { currentContext, tenantId } from '../tenancy/request-context';
import { TenantPrismaClient } from '../tenancy/tenant-prisma';

/** Scoped client or its transaction: both expose the same auditLog delegate. */
type AuditClient = Pick<TenantPrismaClient, 'auditLog'>;

export interface AuditEntry {
  entity: 'premises' | 'premises_settings' | 'gate' | 'department' | 'user';
  entityId: string;
  action: 'create' | 'update' | 'delete' | 'password_reset';
  before?: object | null;
  after?: object | null;
}

const json = (v: object | null | undefined) => (v == null ? Prisma.DbNull : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue));

/**
 * Record of every admin change (append-only table). Pass the same transaction that made the change,
 * so the change and its record are written together or fail together.
 */
export function audit(client: AuditClient, entry: AuditEntry) {
  return client.auditLog.create({
    data: {
      businessId: tenantId(),
      actorId: currentContext()?.userId ?? null,
      entity: entry.entity,
      entityId: entry.entityId,
      action: entry.action,
      before: json(entry.before),
      after: json(entry.after),
    },
  });
}
