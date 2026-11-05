import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';

let phoneCounter = 0;
export function uniquePhone(): string {
  phoneCounter += 1;
  return `+9198${String(10000000 + phoneCounter).slice(-8)}`;
}

export async function seedSite(prisma: PrismaService, name = 'Main Site') {
  const site = await prisma.site.create({ data: { name, address: 'Test' } });
  const gate = await prisma.gate.create({ data: { siteId: site.id, name: 'Main Gate 1' } });
  return { site, gate };
}

export async function seedUser(
  prisma: PrismaService,
  siteId: string,
  role: 'guard' | 'employee' | 'reception' | 'security' | 'admin' = 'employee',
  overrides: Partial<{ name: string; phone: string; isActive: boolean; delegateId: string }> = {},
) {
  return prisma.user.create({
    data: { name: `${role} user`, phone: uniquePhone(), role, siteId, ...overrides },
  });
}

export async function seedVisit(
  prisma: PrismaService,
  overrides: Partial<{
    status: 'INVITED' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'EXPIRED';
    siteId: string;
    hostId: string;
    validFrom: Date;
    validTo: Date;
    type: 'PRE' | 'WALKIN';
  }> = {},
) {
  let siteId = overrides.siteId;
  if (!siteId) siteId = (await seedSite(prisma)).site.id;
  const hostId = overrides.hostId ?? (await seedUser(prisma, siteId)).id;
  const visitor = await prisma.visitor.create({ data: { phone: uniquePhone(), name: 'Rahul Verma' } });
  return prisma.visit.create({
    data: {
      code: `VIS-TEST-${randomUUID().slice(0, 8)}`,
      visitorId: visitor.id,
      hostId,
      siteId,
      type: overrides.type ?? 'PRE',
      purpose: 'Meeting',
      status: overrides.status ?? 'APPROVED',
      validFrom: overrides.validFrom ?? new Date(Date.now() - 60_000),
      validTo: overrides.validTo ?? new Date(Date.now() + 3_600_000),
    },
  });
}

export async function seedVisitEvent(prisma: PrismaService, clientEventId?: string) {
  const visit = await seedVisit(prisma);
  return prisma.visitEvent.create({
    data: { visitId: visit.id, type: 'CREATED', clientEventId },
  });
}
