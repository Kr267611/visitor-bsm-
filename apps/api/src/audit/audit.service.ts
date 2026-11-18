import { Prisma } from '@prisma/client';
import { currentContext, tenantId } from '../tenancy/request-context';
import { TenantPrismaClient } from '../tenancy/tenant-prisma';

/** Scoped client ya uska transaction: dono mein auditLog delegate same hai. */
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
 * Admin ke har badlav ka record (append-only table). Wahi transaction pass karein jisme badlav hua,
 * taaki badlav aur uska record saath mein bane ya saath mein fail ho.
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
