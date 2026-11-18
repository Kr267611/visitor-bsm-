// Development aur staging ke test accounts. Production par nahi chalta.
import { PrismaClient, Role } from '@prisma/client';

if (process.env.NODE_ENV === 'production') {
  throw new Error('Seed production par nahi chalega.');
}

const prisma = new PrismaClient();

const USERS: { name: string; phone: string; role: Role }[] = [
  { name: 'Test Admin', phone: '+919000000001', role: 'admin' },
  { name: 'Test Guard', phone: '+919000000002', role: 'guard' },
  { name: 'Test Employee', phone: '+919000000003', role: 'employee' },
  { name: 'Test Reception', phone: '+919000000004', role: 'reception' },
  { name: 'Test Security', phone: '+919000000005', role: 'security' },
];

async function main() {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: 'standard' } });
  const business = await prisma.business.upsert({
    where: { slug: 'bsm' },
    update: {},
    create: { name: 'BSM', slug: 'bsm', planId: plan.id },
  });
  let premises = await prisma.premises.findFirst({ where: { businessId: business.id, isDefault: true } });
  if (!premises) {
    premises = await prisma.premises.create({
      data: {
        businessId: business.id,
        name: 'Main Site',
        address: 'Test address',
        code: 'BSM001',
        webSlug: 'main-site',
        isDefault: true,
        setting: { create: { businessId: business.id } },
      },
    });
  }
  const gate = await prisma.gate.findFirst({ where: { premisesId: premises.id, name: 'Main Gate 1' } });
  if (!gate) await prisma.gate.create({ data: { businessId: business.id, premisesId: premises.id, name: 'Main Gate 1' } });
  for (const user of USERS) {
    await prisma.user.upsert({
      where: { businessId_phone: { businessId: business.id, phone: user.phone } },
      update: {},
      create: {
        ...user,
        businessId: business.id,
        premises: { create: { premisesId: premises.id, businessId: business.id } },
      },
    });
  }
  // Local testing ka platform super admin (kisi business ka nahi). Sirf OTP se login.
  const superPhone = '+919000000009';
  if (!(await prisma.user.findFirst({ where: { phone: superPhone, businessId: null } }))) {
    await prisma.user.create({ data: { name: 'Platform Admin', phone: superPhone, role: 'super_admin' } });
  }
  console.log(`Seed ho gaya: business "${business.name}", ${USERS.length} users, premises "${premises.name}"`);
}

main().finally(() => prisma.$disconnect());
