# Visitor BSM: poore VMS ka architecture

PRD: "Visitor Management System — PRD (Visitorz.io clone)", 18 Nov 2026 (Deepak Mishra). Yeh doc us PRD ko hamare existing code par kaise banana hai, woh tay karta hai. Phase 1 ka design `docs/design/visitor-bsm-design.html` mein hai; yeh doc usse aage ka hai.

## Intent

Visitorz.io jaisa poora system: ek business ke kai premises, QR / kiosk / manual entry, host ka Accept / Wait / Reject, gate aur meeting dono ka in/out, 10 visit types, custom visitor form, dashboard, reports aur Excel, watchlist, emergency alert, aur plan ke hisaab se modules. User ka pehla aadesh: "authentication se database tak kaam perfect" — yaani neev pakki ho, uske upar modules aayein.

Wajah user ne nahi batayi (BSM ke liye ya bechne ke liye). Isliye design dono ke liye khula rakha hai: multi-tenant shuru se, par billing baad mein.

## Goals

- Ek hi codebase mein kai businesses, har business ka data poori tarah alag.
- Har business ke kai premises; user ek ya zyada premises ka; header mein premises switch.
- Login: mobile/email + password, aur business setting se OTP login. Baad mein Azure AD.
- Permission = role ∩ plan features. Plan mein module nahi to "Access Restricted".
- Har status change aur admin badlav ka tamper-proof audit.
- PRD ke saare modules isi neev par, phase by phase.

## Non-goals (abhi)

- Billing aur payment gateway (plans hain, paisa nahi).
- Face recognition, parcel, events, meeting room booking (PRD Phase 3).
- Native kiosk app: kiosk = fullscreen web (PWA).

## Anti-goals

- Ek business ka data kabhi doosre business ko dikhe: yeh sabse badi failure hai, chahe baaki sab chale.
- Har query mein haath se `businessId` likhna: bhool hogi. Scoping automatic aur "fail closed" ho.
- Phase 1 ka kaam (QR, walk-in, approvals, live desk, outbox) dobara likhna.

## Constraints

- Stack wahi: NestJS + Prisma + PostgreSQL + Redis/BullMQ, React (web), Expo (mobile). Render par deploy.
- India-first: OTP, WhatsApp, Aadhaar sirf masked/last 4, DPDP Act.
- Staging par sirf test data hai, par migration phir bhi data-safe likhni hai.

## Approaches (kaise banayein)

| Approach | Kya | Trade-off |
|---|---|---|
| A. Naya project Next.js mein (PRD ka suggestion) | Sab dobara | Phase 1 ka tested kaam (186+ tests) phenk dena; mahino ka nuksaan |
| **B. Existing stack par multi-tenant neev (chuna)** | Business/Premises/Plan jodo, Site → Premises, tenancy layer | Ek bada refactor abhi, par sab tested kaam bachta hai |
| C. Single-company hi rakho | Sirf BSM | Aasan, par PRD ka multi-premises/plan/super admin nahi ho payega |

B chuna: PRD ke saare features isse ban jaate hain, aur jo kaam ho chuka hai woh bachta hai. PRD ka Next.js sirf suggestion tha; NestJS + React wahi kaam karte hain.

## Architecture

### Tenancy

- **Business** = tenant. **Plan** (features[], limits) har business ka. **Premises** business ke andar. **Gate** premises ke andar.
- Har tenant table mein `business_id`; premises-wise data mein `premises_id` bhi.
- **Request context** (AsyncLocalStorage): `{ businessId, userId, role, premisesIds, activePremisesId }`. Login guard ise set karta hai.
- **Prisma tenant extension**: tenant models par har read/update/delete mein `businessId` khud judta hai, create mein khud bharta hai. Context na ho to query **error deti hai** (fail closed).
- Background jobs (outbox, expiry, timers) aur public token lookups `runAsSystem()` ya `runInTenant(businessId)` se chalte hain — jaan-boojh kar, dikhne wale tareeke se.
- Postgres RLS: abhi nahi. App-level scoping + har surface ka cross-tenant test. RLS baad mein doosri parat ke roop mein (builder ka faisla).

### Identity aur login

- **Ek hi `users` table** sab logon ke liye: panel users aur hosts (Members). Flags: `isHost`, `status` (active/inactive), `role`, `departmentId`, `designation`, `joiningDate`, `passwordHash?`. PRD ke "Members" aur "Manage Users" isi table ke do views hain. (Do alag tables se same insaan ki do copies banti; isliye ek.)
- Roles: `super_admin` (platform, koi business nahi), `admin` (PRD ka System Admin), `reception`, `security`, `guard` (PRD ka Reception/Security), `employee` (PRD ka Member/Host).
- Phone aur email **business ke andar unique**. Login par ek se zyada business mile to API business list lautati hai, user chunta hai.
- Login tareeke: password (Node `scrypt`, koi native dependency nahi) aur OTP (agar business ka `otpLogin` on). Pehli baar user OTP se aata hai aur password set karta hai.
- Tokens: wahi jo Phase 1 mein hain (15 min access JWT + rotating refresh + device revoke + 30s grace), ab JWT mein `businessId` bhi.
- Premises switch: request header `X-Premises-Id`, user ke assigned premises mein se hi; na ho to default premises.
- Super admin: platform routes (`/platform/*`): plan aur business banana, pehla admin banana. Proxy-login (impersonation) audit ke saath, baad ke phase mein.

### Permission

- `can(role, action)` ka ek code matrix (ek jagah).
- `@RequireFeature('emergency_alert')` guard: business ke plan mein feature nahi to 403 `FEATURE_RESTRICTED` ("Access Restricted").
- Limits (visits/premises/members) create ke time check; public page par "Currently unavailable".

### Data model (neev)

Plan, Business, Premises (+ PremisesSetting 1:1), Gate, Department, User, UserPremises (m2m), Visitor (business-wise unique phone), Visit, VisitEvent, Outbox, Device, RefreshToken, AuditLog (generic, append-only trigger, before/after JSON).

Baad ke phases mein judenge: Form/FormField, AppointmentSlot, Group, VisitAsset, Invite, Notification, Watchlist fields, EmergencyAlert, AlertLog.

### Modules aur phases

| Phase | Kya |
|---|---|
| **F. Neev (abhi)** | Tenancy, Business/Premises/Settings, Departments, Users+Members, login v2, permission + plan gating, audit log, Phase 1 flows premises par, web login/switcher/admin basics |
| D. Visitor Desk v2 | Visit types, Accept/Wait/Reject + assets, meeting start/end + notes, form builder, web check-in v2 (geo-fence), kiosk, print pass, in-app notifications bell |
| R. Dashboard aur reports | KPI cards, charts, visits report, Excel export/import, scheduled email |
| A. Appointments aur invites | Slots, reschedule, transfer, delay alert, VIP/Group/Contractor/Special, advance registration, calendar view |
| S. Safety | Watchlist, emergency alert + logs, safety instructions, Google review |
| P. Platform | Super admin panel, impersonation, plans UI, Azure AD |

## Faisle jo builder par chhode

- RLS kab aur kaise (tenancy tests ke saath).
- Migration ka exact SQL (data bachna chahiye: purana Site → Premises, sabko ek default business "BSM" mein).
- Purani `site` naming ka code mein sweep kis order mein.

## Mere liye faisle (user check kar le)

- Multi-tenant shuru se.
- Users aur Members ek table.
- Password hashing `scrypt`.
- RLS baad mein.
- Billing nahi.
