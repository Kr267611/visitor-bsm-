# Visitor BSM: architecture of the full VMS

PRD: "Visitor Management System PRD", 18 Nov 2026. This document decides how to build that PRD on top of the existing code. The Phase 1 design is in `docs/design/visitor-bsm-design.html`; this document covers everything after it.

## Intent

A complete visitor management system: several premises per business, QR / kiosk / manual entry, host Accept / Wait / Reject, in/out at both the gate and the meeting, 10 visit types, a custom visitor form, dashboard, reports and Excel, watchlist, emergency alert, and modules unlocked by plan. The first instruction was to get everything "from authentication to the database" right, so the foundation must be solid before modules are added on top.

The business reason (in-house for BSM, or a product to sell) was not stated, so the design keeps both open: multi-tenant from the start, billing later.

## Goals

- Many businesses in one codebase, each business's data fully isolated.
- Several premises per business; a user belongs to one or more premises; premises switch in the header.
- Sign-in: mobile/email + password, and OTP when the business enables it. Azure AD later.
- Permission = role AND plan features. A module outside the plan shows "Access restricted".
- Tamper-proof audit of every status change and every admin change.
- All PRD modules built on this foundation, phase by phase.

## Non-goals (for now)

- Billing and payment gateway (plans exist, payments do not).
- Face recognition, parcels, events, meeting room booking (PRD Phase 3).
- A native kiosk app: the kiosk is a full-screen web app (PWA).

## Anti-goals

- One business ever seeing another business's data. This is the worst possible failure, even if everything else works.
- Writing `businessId` by hand in every query: someone will forget. Scoping must be automatic and fail closed.
- Rewriting Phase 1 work (QR, walk-in, approvals, live desk, outbox).

## Constraints

- Same stack: NestJS + Prisma + PostgreSQL + Redis/BullMQ, React (web), Expo (mobile). Deployed on Render.
- India first: OTP, WhatsApp, Aadhaar only masked / last 4 digits, DPDP Act.
- Staging holds test data only, but migrations must still be data-safe.

## Approaches

| Approach | What | Trade-off |
|---|---|---|
| A. New project in Next.js (PRD suggestion) | Rebuild everything | Throws away the tested Phase 1 work (186+ tests); months lost |
| **B. Multi-tenant foundation on the existing stack (chosen)** | Add Business/Premises/Plan, Site → Premises, a tenancy layer | One large refactor now, but all tested work is kept |
| C. Stay single-company | BSM only | Simple, but no multi-premises, plans or super admin from the PRD |

B was chosen: it delivers every PRD feature and keeps the work already done. Next.js in the PRD was a suggestion; NestJS + React do the same job.

## Architecture

### Tenancy

- **Business** = tenant. Each business has a **Plan** (features[], limits). **Premises** belong to a business. **Gates** belong to a premises.
- Every tenant table has `business_id`; premises-level data also has `premises_id`.
- **Request context** (AsyncLocalStorage): `{ businessId, userId, role, premisesIds, activePremisesId }`, filled by the sign-in guard.
- **Prisma tenant extension**: on tenant models every read/update/delete gets `businessId` added and every create gets it filled. Without a context the query **throws** (fail closed).
- Background jobs (outbox, expiry, timers) and public token lookups run through `runAsSystem()` or `runInTenant(businessId)`: deliberate and visible.
- Postgres RLS: not now. App-level scoping plus a cross-tenant test for every surface. RLS can be added later as a second layer.

### Identity and sign-in

- **One `users` table** for everyone: panel users and hosts (Members). Fields: `isHost`, `isActive`, `role`, `departmentId`, `designation`, `joiningDate`, `passwordHash?`. The PRD's "Members" and "Manage Users" are two views of this table (two tables would create two copies of the same person).
- Roles: `super_admin` (platform, no business), `admin` (PRD System Admin), `reception`, `security`, `guard` (PRD Reception/Security), `employee` (PRD Member/Host).
- Phone and email are **unique within a business**. When a sign-in matches several businesses, the API returns the business list after the password/OTP is verified, and the user chooses.
- Sign-in methods: password (Node `scrypt`, no native dependency) and OTP (when the business has `otpLogin` on). A first-time user can sign in with OTP and set a password.
- Tokens: as in Phase 1 (15-minute access JWT + rotating refresh token + device revoke + 30-second grace), now with `businessId` in the JWT.
- Premises switch: the `X-Premises-Id` request header, limited to the user's assigned premises; without it the default premises is used.
- Super admin: platform routes (`/platform/*`) to create plans, businesses and the first admin. Audited impersonation comes in a later phase.

### Permission

- A single role-to-action matrix in one place.
- `@RequireFeature('emergency_alert')` guard: when the business plan lacks the feature, 403 `FEATURE_RESTRICTED` ("Access restricted").
- Limits (visits/premises/members) are checked at creation; public pages show "Currently unavailable".

### Data model (foundation)

Plan, Business, Premises (+ PremisesSetting 1:1), Gate, Department, User, UserPremises (m2m), Visitor (phone unique per business), Visit, VisitEvent, Outbox, Device, RefreshToken, AuditLog (generic, append-only trigger, before/after JSON).

Added in later phases: Form/FormField, AppointmentSlot, Group, VisitAsset, Invite, Notification, watchlist fields, EmergencyAlert, AlertLog.

### Modules and phases

| Phase | Scope |
|---|---|
| **F. Foundation (done)** | Tenancy, Business/Premises/Settings, Departments, Users + Members, sign-in v2, permissions + plan gating, audit log, Phase 1 flows on premises, web sign-in / switcher / admin basics |
| D. Visitor Desk v2 | Visit types, Accept/Wait/Reject + assets, meeting start/end + notes, form builder, web check-in v2 (geofence), kiosk, printed pass, in-app notification bell |
| R. Dashboard and reports | KPI cards, charts, visits report, Excel export/import, scheduled email |
| A. Appointments and invites | Slots, reschedule, transfer, delay alert, VIP/Group/Contractor/Special, advance registration, calendar view |
| S. Safety | Watchlist, emergency alert + logs, safety instructions, Google review |
| P. Platform | Super admin panel, impersonation, plans UI, Azure AD |

## Left to the builder

- When and how to add RLS (together with the tenancy tests).
- The exact migration SQL (data must survive: old Site → Premises, everyone into one default business "BSM").
- The order of the sweep that removes old `site` naming from the code.

## Decisions made on the user's behalf (for review)

- Multi-tenant from the start.
- Users and Members in one table.
- Password hashing with `scrypt`.
- RLS later.
- No billing yet.
