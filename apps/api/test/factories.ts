import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';

let phoneCounter = 0;
export function uniquePhone(): string {
  phoneCounter += 1;
  return `+9198${String(10000000 + phoneCounter).slice(-8)}`;
}

let codeCounter = 0;
const nextCode = () => {
  codeCounter += 1;
  return `T${String(codeCounter).padStart(5, '0')}`;
};

/** Naya business (tenant). Cross-tenant tests ke liye alag-alag bana sakte hain. */
export async function seedBusiness(prisma: PrismaService, slug = `biz-${randomUUID().slice(0, 8)}`) {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: 'standard' } });
  return prisma.business.create({ data: { name: `Business ${slug}`, slug, planId: plan.id } });
}

/** Test ka default business: har test ke liye ek hi. */
async function defaultBusiness(prisma: PrismaService) {
  return (await prisma.business.findUnique({ where: { slug: 'test-biz' } })) ?? seedBusiness(prisma, 'test-biz');
}

/**
 * Premises + gate. Naam purana rakha (`seedSite`) taaki tests seedha padhe jayein; `site` ab ek premises hai.
 * businessId na do to sab ek hi test business mein bante hain.
 */
export async function seedSite(prisma: PrismaService, name = 'Main Site', businessId?: string) {
  const business = businessId
    ? await prisma.business.findUniqueOrThrow({ where: { id: businessId } })
    : await defaultBusiness(prisma);
  const isFirst = !(await prisma.premises.count({ where: { businessId: business.id } }));
  const site = await prisma.premises.create({
    data: {
      businessId: business.id,
      name,
      address: 'Test',
      code: nextCode(),
      webSlug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomUUID().slice(0, 4)}`,
      isDefault: isFirst,
      setting: { create: { businessId: business.id } },
    },
  });
  const gate = await prisma.gate.create({ data: { businessId: business.id, premisesId: site.id, name: 'Main Gate 1' } });
  return { site, gate, business };
}

export async function seedUser(
  prisma: PrismaService,
  premisesId: string,
  role: 'guard' | 'employee' | 'reception' | 'security' | 'admin' = 'employee',
  overrides: Partial<{ name: string; phone: string; isActive: boolean; delegateId: string; isHost: boolean }> = {},
) {
  const { businessId } = await prisma.premises.findUniqueOrThrow({ where: { id: premisesId } });
  return prisma.user.create({
    data: {
      name: `${role} user`,
      phone: uniquePhone(),
      role,
      businessId,
      premises: { create: { premisesId, businessId } },
      ...overrides,
    },
  });
}

export async function seedVisitor(prisma: PrismaService, businessId: string, data: { phone?: string; name?: string } = {}) {
  return prisma.visitor.create({ data: { businessId, phone: data.phone ?? uniquePhone(), name: data.name ?? 'Rahul Verma' } });
}

export async function seedVisit(
  prisma: PrismaService,
  overrides: Partial<{
    status: 'INVITED' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'EXPIRED';
    premisesId: string;
    hostId: string;
    validFrom: Date;
    validTo: Date;
    type: 'PRE' | 'WALKIN';
  }> = {},
) {
  const premisesId = overrides.premisesId ?? (await seedSite(prisma)).site.id;
  const { businessId } = await prisma.premises.findUniqueOrThrow({ where: { id: premisesId } });
  const hostId = overrides.hostId ?? (await seedUser(prisma, premisesId)).id;
  const visitor = await seedVisitor(prisma, businessId);
  return prisma.visit.create({
    data: {
      code: `VIS-TEST-${randomUUID().slice(0, 8)}`,
      visitorId: visitor.id,
      hostId,
      businessId,
      premisesId,
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
    data: { visitId: visit.id, businessId: visit.businessId, type: 'CREATED', clientEventId },
  });
}
