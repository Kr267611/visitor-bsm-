# Foundation: tenancy, sign-in v2, permissions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status (2026-11-18):** F1–F8 are done on the `foundation` branch. F9 (mobile) is next.

**Goal:** Turn the single-company system into a multi-tenant one: Business, Plan, Premises, Departments, Users/Members, sign-in v2 (password + OTP + business choice), premises switch, role AND plan permissions, audit log — with every Phase 1 flow running on top.

**Architecture:** Business = tenant. The request context (AsyncLocalStorage) carries `businessId` and the active premises. Services use a **scoped Prisma client** (`TenantPrisma`) that adds `businessId` to every query and throws without a context. Jobs, auth lookups and public token lookups use the raw `PrismaService`, `runAsSystem()` or `runInTenant()`.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL, Node `crypto.scrypt`, AsyncLocalStorage, React web, Expo mobile.

**Spec:** `docs/superpowers/specs/2026-11-18-vms-architecture-design.md`

## Global Constraints

- One business must never see another's data. Every new endpoint needs a cross-tenant test.
- The scoped client fails closed: it throws without a context.
- Phone and email are unique within a business (`@@unique([businessId, phone])`).
- When a sign-in identifier matches several businesses, the list is shown **only after the OTP/password is verified** (selection token), never before.
- Password: `scrypt` (N=16384, r=8, p=1, 64-byte key, 16-byte salt), format `scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>`, at least 6 characters (letters, digits or both).
- A missing plan feature gives 403 `FEATURE_RESTRICTED` with the message `Access restricted: this module is not included in your plan.`
- Data-safe migration: old sites → premises, all rows into one default business "BSM" (slug `bsm`).
- All Phase 1 tests (API 172 e2e + 11 unit, shared 42, web 98, mobile 89) pass with the new naming.

## Review Focus

1. A user of business A changes a URL/ID to see or change business B's visit, visitor, photo, member or premises.
2. One phone in two businesses: sign-in lands in the chosen business, never the wrong one.
3. A user not assigned to premises X still sends `X-Premises-Id: X`.
4. Migration with existing data: no visit, visitor or event is lost.
5. A background job or public link accidentally uses the scoped client without a tenant context and returns 500.

---

### Task F1: Database — Plan, Business, Premises, Departments, tenancy columns

**Files:** `apps/api/prisma/schema.prisma`, migration `2026111800_multi_tenant`, `apps/api/test/setup.ts` (TRUNCATE list), `apps/api/test/factories.ts`, `apps/api/test/tenancy-migration.e2e.ts`

**Produces:**
- Models: `Plan(code unique, features[], visitLimit?, premisesLimit?, memberLimit?)`, `Business(name, slug unique, planId, otpLogin=true, isActive)`, `Premises` (table rename `sites`→`premises`; `businessId, code` 6-char unique kiosk code, `webSlug` unique per business, `mobile?, email?, lat?, lng?, geofenceM?, category, isDefault, purposes[]`), `PremisesSetting` (1:1, settings from the PRD, with defaults), `Department(businessId, name, unique per business)`, `UserPremises(userId, premisesId, businessId)`, `AuditLog` (append-only trigger).
- `businessId` on: gates, users (nullable sirf super_admin), user_premises, visitors, visits, visit_events, outbox (nullable), premises_settings, departments, audit_logs.
- Renames: `site_id`→`premises_id` (visits, gates); `users.site_id` → `user_premises` rows; `users.department` text → `departments` + `department_id`.
- New user fields: `passwordHash?, designation?, joiningDate?, isHost=true`.
- Role enum + `super_admin`.
- Factories: `seedBusiness()`, `seedSite()` → `seedPremises()` (returns `{ business, premises, gate }`), `seedUser(prisma, premises, role, over)`.

- [x] Test: migration on a DB with Phase 1 data keeps all rows (run old migrations, insert Phase 1 data with raw SQL, run new migration, check counts and links).
- [x] Test: `prisma migrate diff --from-migrations --to-schema-datamodel --exit-code` clean.
- [x] Test: unique phone per business (same phone in two businesses allowed, twice in one rejected).
- [x] Test: audit_logs rejects update/delete.
- [x] Implement schema + hand-written SQL; update factories; old suites compile.

### Task F2: Tenant context + scoped Prisma client

**Files:** `src/tenancy/request-context.ts`, `src/tenancy/tenant-prisma.ts`, `src/tenancy/tenancy.module.ts`, `src/tenancy/context.middleware.ts`, test `src/tenancy/tenant-prisma.e2e` (in `test/tenancy.e2e.ts`)

**Produces:**
- `RequestContext { businessId: string | null; userId?; role?; premisesIds: string[]; activePremisesId: string | null; system: boolean }`
- `runInTenant(businessId, fn)`, `runAsSystem(fn)`, `currentContext()`, middleware that runs every HTTP request in an empty mutable store.
- `TenantPrisma` provider: `prisma.$extends` — adds `businessId` to where/data on tenant models; extendedWhereUnique for unique operations; without a context and not system, `Error('Tenant context missing')`.

- [x] Tests: reads only own business; create fills businessId; another business id gives findUnique → null, update → not found; throws without context; runAsSystem sees everything; scoping inside transactions.

### Task F3: Login v2

**Files:** `src/auth/*` (password.ts, auth.service, auth.controller, jwt.guard), `src/admin/admin.controller.ts` (`/me`), tests `test/auth.e2e.ts`, `test/auth-v2.e2e.ts`

**Produces:**
- `POST /auth/login {identifier, password, deviceName}` → session | `409 CHOOSE_BUSINESS {selectionToken, businesses:[{id,name}]}` | `401 INVALID_CREDENTIALS`.
- `POST /auth/otp/request {phone}`, `POST /auth/otp/verify {phone, otp, deviceName}` → session | `409 CHOOSE_BUSINESS`.
- `POST /auth/select-business {selectionToken, businessId, deviceName}` → session (token 5 min, ek baar).
- OTP only for businesses with `otpLogin` on.
- `PUT /me/password {currentPassword?, newPassword}`.
- JWT: `{sub, deviceId, businessId}`. `AuthUser { id, role, businessId, premisesIds, premisesId (active), deviceId }`.
- Header `X-Premises-Id`: one of the user's premises (admin: every premises of the business), otherwise 403. Without it, the default.
- `GET /me` → profile + `business {id,name,slug}` + `premises [{id,name,isDefault}]`.

- [x] Tests: right/wrong password; same phone in two businesses → choose → token for the right business; selection token reuse fails; OTP-off business; unassigned X-Premises-Id → 403; inactive business → 401; existing auth tests renamed.

### Task F4: Permissions + plan gating + limits

**Files:** `src/auth/permissions.ts`, `src/auth/feature.guard.ts`, `src/plans/plan-limits.service.ts`, tests `test/permissions.e2e.ts`

**Produces:** `FEATURES` list; `@RequireFeature(f)`; 403 `FEATURE_RESTRICTED`; `PlanLimits.assert('premises'|'members'|'visits')` → 422 `PLAN_LIMIT`.

- [x] Tests: feature off → 403 with message; on → 200; premises limit; member limit; super_admin on tenant route → 403.

### Task F5: Platform (super admin)

**Files:** `src/platform/platform.controller.ts`, seed update, tests `test/platform.e2e.ts`

**Produces:** `/platform/plans` (GET/POST/PATCH), `/platform/businesses` (GET, POST with first admin + default premises + gate + settings).

- [x] Tests: only super_admin; business create makes everything in one transaction; slug unique.

### Task F6: Admin v2 — premises, settings, gates, departments, members/users, audit

**Files:** `src/admin/*` split into `premises.controller.ts`, `departments.controller.ts`, `users.controller.ts`, `src/audit/audit.service.ts`, tests `test/admin.e2e.ts` (rewrite), `test/admin-v2.e2e.ts`

- [x] Tests: CRUD per entity, cross-tenant 404, audit rows with before/after, host search only `isHost` + active + same premises, department unique per business.

### Task F7: Phase 1 flows on premises + cross-tenant guarantees

**Files:** visits, gate, walk-in, approvals, public-invites, uploads/photos, dashboard, live gateway, jobs (outbox, expiry, timers, retention), passes (`s` = premisesId)

- [x] Rename `siteId`→`premisesId` everywhere; scoped client in services; jobs `runAsSystem`; public routes resolve tenant from token then `runInTenant`.
- [x] Cross-tenant tests: visits list/get/cancel/approve, gate scan with other business QR, walk-in host from other business, dashboard, live socket room, photo URL, devices, public invite token.
- [x] All Phase 1 API suites green.

### Task F8: Shared client + web

- [x] Client: `login`, `selectBusiness`, `X-Premises-Id` header from a `getPremisesId()` option, admin v2 endpoints.
- [x] Web: login page (password tab + OTP tab), choose-business step, premises switcher in side menu, admin pages Premises (+settings basics), Departments, Members.
- [x] Web suite green + new tests.

### Task F9: Mobile

- [ ] Login with choose-business; premises from `/me`; header sent; suites green.
