# Neev (Foundation): tenancy, login v2, permissions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Existing single-company system ko multi-tenant banana: Business, Plan, Premises, Departments, Users/Members, login v2 (password + OTP + business chunna), premises switch, role ∩ plan permission, audit log — aur Phase 1 ke saare flows isi par chalein.

**Architecture:** Business = tenant. Request context (AsyncLocalStorage) mein `businessId` aur active premises. Services ek **scoped Prisma client** (`TenantPrisma`) use karti hain jo har query mein `businessId` khud jodta hai aur context na ho to error deta hai. Jobs, auth lookups aur public token lookups raw `PrismaService` ya `runAsSystem()` se.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL, Node `crypto.scrypt`, AsyncLocalStorage, React web, Expo mobile.

**Spec:** `docs/superpowers/specs/2026-11-18-vms-architecture-design.md`

## Global Constraints

- Ek business ka data doosre ko kabhi na dikhe. Har naye endpoint ka cross-tenant test zaroori.
- Scoped client fail closed: context na ho to throw.
- Phone aur email business ke andar unique (`@@unique([businessId, phone])`).
- Login identifier se kai businesses milein to list sirf **OTP/password sahi hone ke baad** (selection token), pehle nahi.
- Password: `scrypt` (N=16384, r=8, p=1, 64-byte key, 16-byte salt), format `scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>`, min 8 characters.
- Plan feature na ho to 403 `FEATURE_RESTRICTED`, message `Access Restricted: yeh module aapke plan mein nahi hai.`
- Migration data-safe: purane sites → premises, sab rows ek default business "BSM" (slug `bsm`) mein.
- Phase 1 ke saare tests (API 172 e2e + 11 unit, shared 42, web 98, mobile 89) naye naming ke saath pass hon.

## Review Focus

1. Business A ka user URL/ID badal kar Business B ka visit, visitor, photo, member ya premises dekh/badal le.
2. Ek phone do businesses mein: login par sahi business chune, galat mein na ghuse.
3. User ko premises X assign nahi, phir bhi `X-Premises-Id: X` bhej de.
4. Purane data ke saath migration: koi visit, visitor ya event gum na ho.
5. Background job ya public link galti se tenant context ke bina scoped client chala de aur 500 de.

---

### Task F1: Database — Plan, Business, Premises, Departments, tenancy columns

**Files:** `apps/api/prisma/schema.prisma`, migration `2026111800_multi_tenant`, `apps/api/test/setup.ts` (TRUNCATE list), `apps/api/test/factories.ts`, `apps/api/test/tenancy-migration.e2e.ts`

**Produces:**
- Models: `Plan(code unique, features[], visitLimit?, premisesLimit?, memberLimit?)`, `Business(name, slug unique, planId, otpLogin=true, isActive)`, `Premises` (table rename `sites`→`premises`; `businessId, code` 6-char unique kiosk code, `webSlug` unique per business, `mobile?, email?, lat?, lng?, geofenceM?, category, isDefault, purposes[]`), `PremisesSetting` (1:1, PRD ke settings, defaults), `Department(businessId, name, unique per business)`, `UserPremises(userId, premisesId, businessId)`, `AuditLog` (append-only trigger).
- `businessId` on: gates, users (nullable sirf super_admin), user_premises, visitors, visits, visit_events, outbox (nullable), premises_settings, departments, audit_logs.
- Renames: `site_id`→`premises_id` (visits, gates); `users.site_id` → `user_premises` rows; `users.department` text → `departments` + `department_id`.
- New user fields: `passwordHash?, designation?, joiningDate?, isHost=true`.
- Role enum + `super_admin`.
- Factories: `seedBusiness()`, `seedSite()` → `seedPremises()` (returns `{ business, premises, gate }`), `seedUser(prisma, premises, role, over)`.

- [ ] Test: migration on a DB with Phase 1 data keeps all rows (run old migrations, insert Phase 1 data with raw SQL, run new migration, check counts and links).
- [ ] Test: `prisma migrate diff --from-migrations --to-schema-datamodel --exit-code` clean.
- [ ] Test: unique phone per business (same phone in two businesses allowed, twice in one rejected).
- [ ] Test: audit_logs rejects update/delete.
- [ ] Implement schema + hand-written SQL; update factories; old suites compile.

### Task F2: Tenant context + scoped Prisma client

**Files:** `src/tenancy/request-context.ts`, `src/tenancy/tenant-prisma.ts`, `src/tenancy/tenancy.module.ts`, `src/tenancy/context.middleware.ts`, test `src/tenancy/tenant-prisma.e2e` (in `test/tenancy.e2e.ts`)

**Produces:**
- `RequestContext { businessId: string | null; userId?; role?; premisesIds: string[]; activePremisesId: string | null; system: boolean }`
- `runInTenant(businessId, fn)`, `runAsSystem(fn)`, `currentContext()`, middleware jo har HTTP request ko khaali mutable store mein chalata hai.
- `TenantPrisma` provider: `prisma.$extends` — tenant models par where/data mein `businessId`; unique ops ke liye extendedWhereUnique; context nahi aur system nahi to `Error('Tenant context missing')`.

- [ ] Tests: read sirf apne business ka; create mein businessId khud; doosre business ki id se findUnique → null, update → not found; context ke bina throw; runAsSystem sab dekhe; transaction ke andar bhi scoping.

### Task F3: Login v2

**Files:** `src/auth/*` (password.ts, auth.service, auth.controller, jwt.guard), `src/admin/admin.controller.ts` (`/me`), tests `test/auth.e2e.ts`, `test/auth-v2.e2e.ts`

**Produces:**
- `POST /auth/login {identifier, password, deviceName}` → session | `409 CHOOSE_BUSINESS {selectionToken, businesses:[{id,name}]}` | `401 INVALID_CREDENTIALS`.
- `POST /auth/otp/request {phone}`, `POST /auth/otp/verify {phone, otp, deviceName}` → session | `409 CHOOSE_BUSINESS`.
- `POST /auth/select-business {selectionToken, businessId, deviceName}` → session (token 5 min, ek baar).
- OTP sirf un businesses ke liye jinka `otpLogin` on.
- `PUT /me/password {currentPassword?, newPassword}`.
- JWT: `{sub, deviceId, businessId}`. `AuthUser { id, role, businessId, premisesIds, premisesId (active), deviceId }`.
- Header `X-Premises-Id`: user ke premises mein se (admin: business ke saare); warna 403. Na ho to default.
- `GET /me` → profile + `business {id,name,slug}` + `premises [{id,name,isDefault}]`.

- [ ] Tests: password sahi/galat; same phone do businesses → choose → sahi business ka token; selection token reuse fail; OTP off business; X-Premises-Id unassigned → 403; inactive business → 401; existing auth tests naming update.

### Task F4: Permissions + plan gating + limits

**Files:** `src/auth/permissions.ts`, `src/auth/feature.guard.ts`, `src/plans/plan-limits.service.ts`, tests `test/permissions.e2e.ts`

**Produces:** `FEATURES` list; `@RequireFeature(f)`; 403 `FEATURE_RESTRICTED`; `PlanLimits.assert('premises'|'members'|'visits')` → 422 `PLAN_LIMIT`.

- [ ] Tests: feature off → 403 with message; on → 200; premises limit; member limit; super_admin on tenant route → 403.

### Task F5: Platform (super admin)

**Files:** `src/platform/platform.controller.ts`, seed update, tests `test/platform.e2e.ts`

**Produces:** `/platform/plans` (GET/POST/PATCH), `/platform/businesses` (GET, POST with first admin + default premises + gate + settings).

- [ ] Tests: only super_admin; business create makes everything in one transaction; slug unique.

### Task F6: Admin v2 — premises, settings, gates, departments, members/users, audit

**Files:** `src/admin/*` split into `premises.controller.ts`, `departments.controller.ts`, `users.controller.ts`, `src/audit/audit.service.ts`, tests `test/admin.e2e.ts` (rewrite), `test/admin-v2.e2e.ts`

- [ ] Tests: CRUD per entity, cross-tenant 404, audit rows with before/after, host search only `isHost` + active + same premises, department unique per business.

### Task F7: Phase 1 flows on premises + cross-tenant guarantees

**Files:** visits, gate, walk-in, approvals, public-invites, uploads/photos, dashboard, live gateway, jobs (outbox, expiry, timers, retention), passes (`s` = premisesId)

- [ ] Rename `siteId`→`premisesId` everywhere; scoped client in services; jobs `runAsSystem`; public routes resolve tenant from token then `runInTenant`.
- [ ] Cross-tenant tests: visits list/get/cancel/approve, gate scan with other business QR, walk-in host from other business, dashboard, live socket room, photo URL, devices, public invite token.
- [ ] All Phase 1 API suites green.

### Task F8: Shared client + web

- [ ] Client: `login`, `selectBusiness`, `X-Premises-Id` header from a `getPremisesId()` option, admin v2 endpoints.
- [ ] Web: login page (password tab + OTP tab), choose-business step, premises switcher in side menu, admin pages Premises (+settings basics), Departments, Members.
- [ ] Web suite green + new tests.

### Task F9: Mobile

- [ ] Login with choose-business; premises from `/me`; header sent; suites green.
