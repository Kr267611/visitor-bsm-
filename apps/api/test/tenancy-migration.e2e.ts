import { execSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const ADMIN_URL = 'postgresql://visitor:visitor@localhost:5433/visitor_dev';
const DB = 'visitor_migration_test';
const DB_URL = `postgresql://visitor:visitor@localhost:5433/${DB}`;
const API_DIR = join(__dirname, '..');
const NEW_MIGRATION = '20261118090000_multi_tenant';

function sql(url: string, statement: string) {
  execSync(`npx prisma db execute --url "${url}" --stdin`, { cwd: API_DIR, input: statement, stdio: 'pipe' });
}

/** Ek temp folder jisme sirf diye gaye migrations hain. */
function deploy(migrations: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'vms-mig-'));
  cpSync(join(API_DIR, 'prisma', 'schema.prisma'), join(dir, 'schema.prisma'));
  cpSync(join(API_DIR, 'prisma', 'migrations', 'migration_lock.toml'), join(dir, 'migrations', 'migration_lock.toml'));
  for (const m of migrations) cpSync(join(API_DIR, 'prisma', 'migrations', m), join(dir, 'migrations', m), { recursive: true });
  execSync(`npx prisma migrate deploy --schema "${join(dir, 'schema.prisma')}"`, {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL: DB_URL },
    stdio: 'pipe',
  });
  rmSync(dir, { recursive: true, force: true });
}

describe('multi-tenant migration keeps Phase 1 data', () => {
  let db: PrismaClient;
  const all = readdirSync(join(API_DIR, 'prisma', 'migrations')).filter((m) => /^\d/.test(m)).sort();
  const before = all.filter((m) => m < NEW_MIGRATION);

  beforeAll(() => {
    sql(ADMIN_URL, `DROP DATABASE IF EXISTS ${DB};`);
    sql(ADMIN_URL, `CREATE DATABASE ${DB};`);
    deploy(before);
    // Phase 1 jaisa data, purane schema mein.
    sql(
      DB_URL,
      `
      INSERT INTO sites (id, name, address) VALUES
        ('11111111-1111-1111-1111-111111111111', 'Main Site', 'Surat'),
        ('22222222-2222-2222-2222-222222222222', 'Plant 2', NULL);
      INSERT INTO gates (id, site_id, name) VALUES ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Gate 1');
      INSERT INTO users (id, name, phone, role, department, site_id) VALUES
        ('44444444-4444-4444-4444-444444444444', 'Anita', '+919800000001', 'employee', 'Finance', '11111111-1111-1111-1111-111111111111'),
        ('55555555-5555-5555-5555-555555555555', 'Guard', '+919800000002', 'guard', NULL, '22222222-2222-2222-2222-222222222222'),
        ('66666666-6666-6666-6666-666666666666', 'Ravi', '+919800000003', 'employee', 'Finance', NULL);
      INSERT INTO visitors (id, phone, name) VALUES ('77777777-7777-7777-7777-777777777777', '+919811111111', 'Rahul');
      INSERT INTO visits (id, code, visitor_id, host_id, site_id, type, purpose, status, valid_from, valid_to, updated_at)
        VALUES ('88888888-8888-8888-8888-888888888888', 'VIS-1', '77777777-7777-7777-7777-777777777777',
                '44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'PRE', 'Meeting',
                'CHECKED_IN', now(), now() + interval '1 hour', now());
      INSERT INTO visit_events (id, visit_id, type) VALUES (gen_random_uuid(), '88888888-8888-8888-8888-888888888888', 'CREATED');
      INSERT INTO outbox (id, visit_id, channel, template, recipient, vars) VALUES
        (gen_random_uuid(), '88888888-8888-8888-8888-888888888888', 'SMS', 'PASS_READY', '+919811111111', '{}');
      `,
    );
    deploy(all);
    db = new PrismaClient({ datasources: { db: { url: DB_URL } } });
  }, 120_000);

  afterAll(async () => {
    await db?.$disconnect();
    sql(ADMIN_URL, `DROP DATABASE IF EXISTS ${DB};`);
  });

  it('puts everything into one default business on the standard plan', async () => {
    const businesses = await db.business.findMany({ include: { plan: true } });
    expect(businesses).toHaveLength(1);
    expect(businesses[0]).toMatchObject({ slug: 'bsm', name: 'BSM' });
    expect(businesses[0].plan.features).toEqual(expect.arrayContaining(['visitor_desk', 'emergency_alert']));
  });

  it('sites became premises with codes, settings and one default', async () => {
    const premises = await db.premises.findMany({ include: { setting: true }, orderBy: { name: 'asc' } });
    expect(premises.map((p) => p.name)).toEqual(['Main Site', 'Plant 2']);
    expect(premises.every((p) => /^[0-9A-F]{6}$/.test(p.code))).toBe(true);
    expect(premises.every((p) => p.setting)).toBe(true);
    expect(premises.filter((p) => p.isDefault)).toHaveLength(1);
    expect(premises[0].webSlug).toMatch(/^main-site-/);
  });

  it('users keep their premises and department', async () => {
    const anita = await db.user.findUniqueOrThrow({
      where: { id: '44444444-4444-4444-4444-444444444444' },
      include: { premises: true, department: true },
    });
    expect(anita.premises.map((p) => p.premisesId)).toEqual(['11111111-1111-1111-1111-111111111111']);
    expect(anita.department?.name).toBe('Finance');
    expect(anita.businessId).toBeTruthy();
    expect(await db.department.count()).toBe(1);
    const ravi = await db.user.findUniqueOrThrow({ where: { id: '66666666-6666-6666-6666-666666666666' }, include: { premises: true } });
    expect(ravi.premises).toHaveLength(0);
  });

  it('visit, gate, visitor, event and outbox keep their links', async () => {
    const visit = await db.visit.findUniqueOrThrow({ where: { id: '88888888-8888-8888-8888-888888888888' } });
    expect(visit.premisesId).toBe('11111111-1111-1111-1111-111111111111');
    expect(visit.status).toBe('CHECKED_IN');
    const business = await db.business.findFirstOrThrow();
    expect(visit.businessId).toBe(business.id);
    expect((await db.gate.findFirstOrThrow()).businessId).toBe(business.id);
    expect((await db.visitor.findFirstOrThrow()).businessId).toBe(business.id);
    expect((await db.visitEvent.findFirstOrThrow()).businessId).toBe(business.id);
    expect((await db.outbox.findFirstOrThrow()).businessId).toBe(business.id);
  });

  it('visit events are still append-only after the migration', async () => {
    await expect(db.$executeRawUnsafe(`UPDATE visit_events SET type = 'X'`)).rejects.toThrow(/append-only/);
  });

  it('schema and migrations match exactly', () => {
    execSync(
      `npx prisma migrate diff --from-url "${DB_URL}" --to-schema-datamodel prisma/schema.prisma --exit-code`,
      { cwd: API_DIR, stdio: 'pipe' },
    );
  });
});
