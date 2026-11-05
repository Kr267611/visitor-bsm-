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
  const site =
    (await prisma.site.findFirst({ where: { name: 'Main Site' } })) ??
    (await prisma.site.create({ data: { name: 'Main Site', address: 'Test address' } }));
  const gate = await prisma.gate.findFirst({ where: { siteId: site.id, name: 'Main Gate 1' } });
  if (!gate) await prisma.gate.create({ data: { siteId: site.id, name: 'Main Gate 1' } });
  for (const user of USERS) {
    await prisma.user.upsert({
      where: { phone: user.phone },
      update: {},
      create: { ...user, siteId: site.id },
    });
  }
  console.log(`Seed ho gaya: ${USERS.length} users, site "${site.name}"`);
}

main().finally(() => prisma.$disconnect());
