// Creates the first business, its default premises, a Main Gate and the first admin, in one transaction.
// For a fresh database before the platform admin screens exist. Never run it twice for the same slug.
//
// Run from apps/api:
//   DATABASE_URL=... BUSINESS_NAME="Acme Ltd" BUSINESS_SLUG=acme PREMISES_NAME="Head Office" \
//   ADMIN_NAME="Jane Doe" ADMIN_PHONE=9876543210 ADMIN_EMAIL=jane@acme.in \
//   PASSWORD_FILE=../../.tools/first-login.txt npx tsx scripts/create-first-business.ts
//
// A random temporary password is written to PASSWORD_FILE (never printed). Change it after the first sign-in.
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth/password';
import { requirePhone } from '../src/common/parse';
import { kioskCode, slugify } from '../src/common/records';

function need(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name}.`);
  return value;
}

async function main() {
  const businessName = need('BUSINESS_NAME');
  const businessSlug = need('BUSINESS_SLUG');
  const premisesName = need('PREMISES_NAME');
  const adminName = need('ADMIN_NAME');
  const adminPhone = requirePhone(need('ADMIN_PHONE'));
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase() || null;
  const passwordFile = need('PASSWORD_FILE');

  const prisma = new PrismaClient();
  try {
    const plan = await prisma.plan.findUnique({ where: { code: 'standard' } });
    if (!plan) throw new Error('The "standard" plan is missing. Have the migrations run?');

    const password = randomBytes(9).toString('base64url');
    const passwordHash = await hashPassword(password);

    const result = await prisma.$transaction(async (tx) => {
      const business = await tx.business.create({
        data: { name: businessName, slug: businessSlug, planId: plan.id, otpLogin: true },
      });
      const businessId = business.id;
      const premises = await tx.premises.create({
        data: {
          businessId,
          name: premisesName,
          code: kioskCode(),
          webSlug: slugify(premisesName),
          isDefault: true,
          setting: { create: { businessId } },
        },
      });
      await tx.gate.create({ data: { businessId, premisesId: premises.id, name: 'Main Gate' } });
      const admin = await tx.user.create({
        data: {
          businessId,
          name: adminName,
          phone: adminPhone,
          email: adminEmail,
          role: 'admin',
          passwordHash,
          premises: { create: { premisesId: premises.id, businessId } },
        },
      });
      return { business, premises, admin };
    });

    writeFileSync(
      passwordFile,
      [
        `Sign in: ${adminEmail ?? adminPhone}`,
        `Temporary password: ${password}`,
        'Change it after the first sign-in (Account > Password).',
        '',
      ].join('\n'),
    );
    console.log(
      `Created business "${result.business.name}" (${result.business.slug}), premises "${result.premises.name}", ` +
        `Main Gate and admin ${result.admin.name}. Password saved to ${passwordFile}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
