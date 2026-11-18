-- Multi-tenant neev. Purana data bachta hai: sites -> premises, sab ek default business "BSM" mein.

-- Enums
CREATE TYPE "PremisesCategory" AS ENUM ('business', 'events', 'exhibition');
ALTER TYPE "Role" ADD VALUE 'super_admin';

-- Plans aur businesses
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "features" TEXT[],
    "visit_limit" INTEGER,
    "premises_limit" INTEGER,
    "member_limit" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

INSERT INTO "plans" ("id", "code", "name", "features")
VALUES (gen_random_uuid(), 'standard', 'Standard', ARRAY[
  'visitor_desk', 'dashboard', 'reports', 'invites', 'appointments', 'watchlist',
  'emergency_alert', 'kiosk', 'bulk_import', 'form_builder', 'azure_ad'
]);

CREATE TABLE "businesses" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo_key" TEXT,
    "plan_id" UUID NOT NULL,
    "otp_login" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "businesses_slug_key" ON "businesses"("slug");
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Purana data ho to use ek default business mein rakho.
INSERT INTO "businesses" ("id", "name", "slug", "plan_id")
SELECT gen_random_uuid(), 'BSM', 'bsm', (SELECT "id" FROM "plans" WHERE "code" = 'standard')
WHERE EXISTS (SELECT 1 FROM "sites") OR EXISTS (SELECT 1 FROM "users") OR EXISTS (SELECT 1 FROM "visitors");

-- sites -> premises (rename, data wahi)
ALTER TABLE "gates" DROP CONSTRAINT "gates_site_id_fkey";
ALTER TABLE "users" DROP CONSTRAINT "users_site_id_fkey";
ALTER TABLE "visits" DROP CONSTRAINT "visits_site_id_fkey";

ALTER TABLE "sites" RENAME TO "premises";
ALTER TABLE "premises" RENAME CONSTRAINT "sites_pkey" TO "premises_pkey";
ALTER TABLE "premises"
  ADD COLUMN "business_id" UUID,
  ADD COLUMN "code" TEXT,
  ADD COLUMN "web_slug" TEXT,
  ADD COLUMN "mobile" TEXT,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "lat" DOUBLE PRECISION,
  ADD COLUMN "lng" DOUBLE PRECISION,
  ADD COLUMN "geofence_m" INTEGER,
  ADD COLUMN "category" "PremisesCategory" NOT NULL DEFAULT 'business',
  ADD COLUMN "is_default" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "purposes" TEXT[] DEFAULT ARRAY['Enquiry', 'Casual Meet', 'Appointment', 'Meeting', 'Visitor']::TEXT[];

UPDATE "premises" SET
  "business_id" = (SELECT "id" FROM "businesses" WHERE "slug" = 'bsm'),
  "code" = upper(substr(md5(random()::text || "id"::text), 1, 6)),
  "web_slug" = trim(both '-' from lower(regexp_replace("name", '[^a-zA-Z0-9]+', '-', 'g'))) || '-' || substr("id"::text, 1, 4);
UPDATE "premises" SET "is_default" = true
WHERE "id" = (SELECT "id" FROM "premises" ORDER BY "created_at" LIMIT 1);

ALTER TABLE "premises"
  ALTER COLUMN "business_id" SET NOT NULL,
  ALTER COLUMN "code" SET NOT NULL,
  ALTER COLUMN "web_slug" SET NOT NULL;
CREATE UNIQUE INDEX "premises_code_key" ON "premises"("code");
CREATE INDEX "premises_business_id_idx" ON "premises"("business_id");
CREATE UNIQUE INDEX "premises_business_id_web_slug_key" ON "premises"("business_id", "web_slug");
ALTER TABLE "premises" ADD CONSTRAINT "premises_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Har premises ki settings
CREATE TABLE "premises_settings" (
    "premises_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "visit_start" TEXT,
    "visit_end" TEXT,
    "checkin_on_approval" BOOLEAN NOT NULL DEFAULT true,
    "only_checkin" BOOLEAN NOT NULL DEFAULT false,
    "auto_checkout_hrs" INTEGER,
    "overstay_min" INTEGER,
    "waiting_min" INTEGER,
    "default_visit_min" INTEGER NOT NULL DEFAULT 240,
    "slot_min" INTEGER NOT NULL DEFAULT 30,
    "delay_alert_min" INTEGER,
    "only_member_checkin" BOOLEAN NOT NULL DEFAULT false,
    "report_emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "report_schedule" TEXT,
    "google_review_url" TEXT,
    "exit_plan_key" TEXT,
    CONSTRAINT "premises_settings_pkey" PRIMARY KEY ("premises_id")
);
ALTER TABLE "premises_settings" ADD CONSTRAINT "premises_settings_premises_id_fkey" FOREIGN KEY ("premises_id") REFERENCES "premises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
INSERT INTO "premises_settings" ("premises_id", "business_id") SELECT "id", "business_id" FROM "premises";

-- Gates
ALTER TABLE "gates" ADD COLUMN "business_id" UUID;
ALTER TABLE "gates" RENAME COLUMN "site_id" TO "premises_id";
UPDATE "gates" g SET "business_id" = p."business_id" FROM "premises" p WHERE p."id" = g."premises_id";
ALTER TABLE "gates" ALTER COLUMN "business_id" SET NOT NULL;
ALTER TABLE "gates" ADD CONSTRAINT "gates_premises_id_fkey" FOREIGN KEY ("premises_id") REFERENCES "premises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Departments (purane text se)
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "departments_business_id_name_key" ON "departments"("business_id", "name");
ALTER TABLE "departments" ADD CONSTRAINT "departments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Users
ALTER TABLE "users"
  ADD COLUMN "business_id" UUID,
  ADD COLUMN "department_id" UUID,
  ADD COLUMN "designation" TEXT,
  ADD COLUMN "is_host" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "joining_date" TIMESTAMP(3),
  ADD COLUMN "password_hash" TEXT;
UPDATE "users" SET "business_id" = (SELECT "id" FROM "businesses" WHERE "slug" = 'bsm');

INSERT INTO "departments" ("id", "business_id", "name")
SELECT gen_random_uuid(), d."business_id", d."department"
FROM (SELECT DISTINCT "business_id", trim("department") AS "department" FROM "users"
      WHERE "department" IS NOT NULL AND trim("department") <> '') d;
UPDATE "users" u SET "department_id" = d."id"
FROM "departments" d WHERE d."business_id" = u."business_id" AND d."name" = trim(u."department");

CREATE TABLE "user_premises" (
    "user_id" UUID NOT NULL,
    "premises_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    CONSTRAINT "user_premises_pkey" PRIMARY KEY ("user_id", "premises_id")
);
CREATE INDEX "user_premises_premises_id_idx" ON "user_premises"("premises_id");
ALTER TABLE "user_premises" ADD CONSTRAINT "user_premises_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_premises" ADD CONSTRAINT "user_premises_premises_id_fkey" FOREIGN KEY ("premises_id") REFERENCES "premises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
INSERT INTO "user_premises" ("user_id", "premises_id", "business_id")
SELECT "id", "site_id", "business_id" FROM "users" WHERE "site_id" IS NOT NULL;

ALTER TABLE "users" DROP COLUMN "department", DROP COLUMN "site_id";
DROP INDEX "users_phone_key";
CREATE UNIQUE INDEX "users_business_id_phone_key" ON "users"("business_id", "phone");
CREATE UNIQUE INDEX "users_business_id_email_key" ON "users"("business_id", "email");
ALTER TABLE "users" ADD CONSTRAINT "users_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Visitors
ALTER TABLE "visitors" ADD COLUMN "business_id" UUID;
UPDATE "visitors" SET "business_id" = (SELECT "id" FROM "businesses" WHERE "slug" = 'bsm');
ALTER TABLE "visitors" ALTER COLUMN "business_id" SET NOT NULL;
DROP INDEX "visitors_phone_key";
CREATE UNIQUE INDEX "visitors_business_id_phone_key" ON "visitors"("business_id", "phone");
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Visits
DROP INDEX "visits_site_id_status_idx";
ALTER TABLE "visits" RENAME COLUMN "site_id" TO "premises_id";
ALTER TABLE "visits" ADD COLUMN "business_id" UUID;
UPDATE "visits" v SET "business_id" = p."business_id" FROM "premises" p WHERE p."id" = v."premises_id";
ALTER TABLE "visits" ALTER COLUMN "business_id" SET NOT NULL;
CREATE INDEX "visits_premises_id_status_idx" ON "visits"("premises_id", "status");
CREATE INDEX "visits_business_id_created_at_idx" ON "visits"("business_id", "created_at");
ALTER TABLE "visits" ADD CONSTRAINT "visits_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visits" ADD CONSTRAINT "visits_premises_id_fkey" FOREIGN KEY ("premises_id") REFERENCES "premises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Visit events: audit log hai, isliye trigger sirf is backfill ke liye band.
ALTER TABLE "visit_events" ADD COLUMN "business_id" UUID;
ALTER TABLE "visit_events" DISABLE TRIGGER "visit_events_no_change";
UPDATE "visit_events" e SET "business_id" = v."business_id" FROM "visits" v WHERE v."id" = e."visit_id";
ALTER TABLE "visit_events" ENABLE TRIGGER "visit_events_no_change";
ALTER TABLE "visit_events" ALTER COLUMN "business_id" SET NOT NULL;

-- Outbox
ALTER TABLE "outbox" ADD COLUMN "business_id" UUID;
UPDATE "outbox" o SET "business_id" = v."business_id" FROM "visits" v WHERE v."id" = o."visit_id";

-- Admin badlavon ka audit, append-only
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "business_id" UUID,
    "actor_id" UUID,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "audit_logs_business_id_entity_entity_id_idx" ON "audit_logs"("business_id", "entity", "entity_id");

CREATE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_change
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
