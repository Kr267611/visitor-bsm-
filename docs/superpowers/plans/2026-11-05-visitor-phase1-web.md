# Visitor System Phase 1: Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ek React web app jismein visitor ka public page, reception ka live desk, host ke invite/approval screens aur admin settings hon.

**Architecture:** `apps/web` ek Vite + React SPA hai. Saara API kaam `@visitor/shared` ke client se hota hai. Live data TanStack Query mein rehta hai. Socket event sirf query refresh karwata hai, aur socket toote to 30 second polling chalti hai.

**Tech Stack:** React, Vite, TypeScript, TanStack Query, React Router, socket.io-client, qrcode.react, Vitest + Testing Library + MSW.

**Spec:** `docs/design/visitor-bsm-design.html`

**Depends on:** `2026-11-05-visitor-phase1-backend.md` poora ho chuka ho, khaas kar Task 12 (`createApiClient`).

## Global Constraints

- Backend plan ke Global Constraints yahan bhi lagu hain.
- Visitor page bina login aur bina install ke, phone browser par chale, 400px width par.
- Visitor page par poora ID number ka field nahi hoga. Sirf ID type aur last 4 digit.
- UI copy Hinglish mein, design ke shabdon mein.
- Status badge ka text exact status naam se aaye, ek hi `StatusBadge` component se.
- Reception aur admin screens desktop ke liye, par 768px par bhi use ho sakein.
- Web app Vercel par sirf static build ke roop mein. Vercel Functions nahi, saara logic Render wale API mein. Browser API aur Socket.IO se seedha `VITE_API_URL` (Render) par baat karega.
- Invite links custom domain par hon, `*.vercel.app` par nahi. Preview deployments sirf staging API se judein, production API se nahi.

## Review Focus

1. Visitor 12 MB ki camera photo chune: upload se pehle compress ho, form na toote. Test: Task 2.
2. Expired ya cancelled link khole: form nahi, saaf message dikhe. Test: Task 2.
3. Reception ka socket toot jaye: list 30 second mein phir bhi update ho aur "live nahi hai" dikhe. Test: Task 3.
4. Slow network par form do baar submit, ya submit fail: button disabled rahe, fail par bhara hua form bacha rahe. Test: Task 2.
5. Desk par session expire ho jaye: login par jaye, wapas usi page par aaye. Test: Task 1.

---

### Task 1: App skeleton aur login

**Files:**
- Create: `apps/web/` (Vite app), `src/api.ts`, `src/auth/AuthProvider.tsx`, `src/auth/LoginPage.tsx`, `src/auth/RequireRole.tsx`, `src/app/routes.tsx`, `src/ui/tokens.css`, `src/ui/StatusBadge.tsx`
- Test: `apps/web/src/auth/auth.test.tsx`

**Interfaces:**
- Consumes: `createApiClient`, `Role`, `VisitStatus` (`@visitor/shared`)
- Produces: `useApi(): ApiClient`, `useAuth(): {user, login, logout}`, `<RequireRole roles={Role[]}>`
- Produces: routes `/login`, `/desk`, `/my`, `/my/invite`, `/admin/*`, `/v/:token`, `/privacy`. Login ke baad: reception, security → `/desk`. employee → `/my`. admin → `/admin`. guard → `/desk`.
- Values: Tokens `localStorage` mein, try/catch ke saath.

- [ ] **Step 1: Failing tests likhein**

```tsx
it('OTP login redirects by role', ...);          // reception => /desk
it('wrong OTP shows message, keeps phone', ...);
it('rate limit shows wait message', ...);        // OTP_RATE_LIMITED
it('RequireRole shows no-access for wrong role', ...);
it('session expiry goes to /login?next=<page> and returns after login', ...);
```

- [ ] **Step 2: Run karein:** `pnpm --filter web test auth`. Expected: FAIL.
- [ ] **Step 3: App, routes, auth aur design tokens likhein.**
- [ ] **Step 4: Run karein:** `pnpm --filter web test auth`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat(web): app shell, OTP login and role routes"`

### Task 2: Visitor ka public page

**Files:**
- Create: `apps/web/src/visitor/InvitePage.tsx`, `VisitorForm.tsx`, `PassView.tsx`, `compressPhoto.ts`, `PrivacyPage.tsx`
- Test: `apps/web/src/visitor/invite.test.tsx`, `compressPhoto.test.ts`

**Interfaces:**
- Consumes: `publicInvites.get`, `publicInvites.uploadPhoto`, `publicInvites.register`
- Produces: `compressPhoto(file: File, maxBytes = 200_000): Promise<Blob>`, canvas se JPEG, lambi side max 1024px.
- Screens status ke hisaab se:

| Status | Dikhega |
|---|---|
| `INVITED` | Form: naam, company, photo, ID type, last 4 digit, consent |
| `APPROVED` | QR pass, host, site, valid time |
| `CHECKED_IN` | QR pass aur "Aap andar hain. Jaate waqt yeh QR gate par dikhayein." |
| `CHECKED_OUT` | "Aapki visit poori ho gayi. Dhanyavaad." |
| `CANCELLED` | "Yeh visit cancel ho gayi hai. Apne host se baat karein." |
| `EXPIRED` | "Is link ka time khatam ho gaya hai. Apne host se naya link maangein." |
| 404 | "Yeh link sahi nahi hai. Apne host se naya link maangein." |

- Values: Consent checkbox pehle se tick nahi hoga, aur text mein `/privacy` ka link hoga. `/privacy` ka text `CONSENT_VERSION` se match kare. Final wording legal se confirm hogi.

- [ ] **Step 1: Failing tests likhein**

```tsx
it.each(statusCases)('status %s shows correct screen', ...);
it('submit blocked until consent and photo present', ...);
it('idLast4 accepts only 4 digits', ...);
it('button disabled during submit: double click sends one request', ...);
it('failed submit shows error and keeps entered values', ...);
it('success shows QR without page reload', ...);
it('large photo is compressed to <= 200 KB before upload', ...);
it('non-image file shows message', ...);
```

- [ ] **Step 2: Run karein:** `pnpm --filter web test visitor`. Expected: FAIL.
- [ ] **Step 3: Page aur components likhein.**
- [ ] **Step 4: Run karein:** `pnpm --filter web test visitor`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat(web): public visitor registration and QR pass"`

### Task 3: Live reception desk

**Files:**
- Create: `apps/web/src/desk/DeskPage.tsx`, `VisitRow.tsx`, `useLiveSite.ts`
- Test: `apps/web/src/desk/desk.test.tsx`, `useLiveSite.test.ts`

**Interfaces:**
- Consumes: `dashboard.live`, `visits.checkIn`, `visits.checkOut`, `visits.approve`, `visits.reject`, socket `/live`
- Produces: `useLiveSite(): { data: LiveDashboard | undefined; connected: boolean }`. Socket connect na ho to `refetchInterval: 30_000`.
- Layout: chaar lists: Host ko call karein (`needsCall`, sabse upar), Approval baaki (`pending`), Aane wale (`expected`), Andar hain (`inside`), aur naam ya code se search.
- Values: Desk ek baar apna gate chunta hai, `localStorage` mein yaad rehta hai. Manual check-in aur check-out isi `gateId` ke saath jate hain, aur har action ka apna `clientEventId` (UUID) hota hai.

- [ ] **Step 1: Failing tests likhein**

```tsx
it('renders 4 lists from dashboard data', ...);
it('needsCall appears first with host name', ...);
it('visit.updated refetches dashboard', ...);
it('socket down: shows "Live nahi hai" and polls every 30s', ...);
it('manual check-out asks confirmation in page, then updates list', ...);
it('check-out conflict shows server message', ...);
it('reception can approve from pending list', ...);
```

- [ ] **Step 2: Run karein:** `pnpm --filter web test desk`. Expected: FAIL.
- [ ] **Step 3: Desk likhein.**
- [ ] **Step 4: Run karein:** `pnpm --filter web test desk`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat(web): live reception desk"`

### Task 4: Host: invite aur approvals

**Files:**
- Create: `apps/web/src/host/MyVisitsPage.tsx`, `InviteForm.tsx`, `ApprovalPage.tsx`, `DelegateSetting.tsx`
- Test: `apps/web/src/host/host.test.tsx`

**Interfaces:**
- Consumes: `visits.create`, `visits.list`, `visits.get`, `visits.cancel`, `visits.resendInvite`, `visits.approve`, `visits.reject`, `me.update`, `users.searchHosts`
- Produces: route `/my/visits/:id`. Yahi link SMS fallback mein jata hai (backend Task 7).

- [ ] **Step 1: Failing tests likhein**

```tsx
it('invite form validates phone with normalizeIndianPhone', ...);
it('end time before start blocked', ...);
it('invite success shows new visit in list', ...);
it('approval page approve/reject works', ...);
it('already decided visit shows the current status, no buttons', ...);
it('SMS link while logged out returns here after login', ...);
it('cancel available only for INVITED and APPROVED', ...);
it('delegate can be set and cleared', ...);
```

- [ ] **Step 2: Run karein:** `pnpm --filter web test host`. Expected: FAIL.
- [ ] **Step 3: Screens likhein.**
- [ ] **Step 4: Run karein:** `pnpm --filter web test host`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat(web): host invites and approvals"`

### Task 5: Admin aur deploy

**Files:**
- Create: `apps/web/src/admin/UsersPage.tsx`, `SitesPage.tsx`, `DevicesPanel.tsx`
- Create: `apps/web/vercel.json`
- Test: `apps/web/src/admin/admin.test.tsx`

**Interfaces:**
- Consumes: `admin.users.*`, `admin.sites.*`, `admin.gates.*`, `admin.devices.list`, `admin.devices.revoke`
- Values: User delete nahi, sirf deactivate. `vercel.json` mein `/(.*)` ka rewrite `/index.html` par, aur `/v/(.*)` par header `Referrer-Policy: no-referrer`, taaki invite token bahar na jaye. Vercel project ka root `apps/web`, aur workspace ke bahar ki files (`packages/shared`) build mein shamil rahein.

- [ ] **Step 1: Failing tests likhein**

```tsx
it('creates user and shows in the list', ...);
it('duplicate phone shows server message', ...);
it('deactivate confirms in page, then marks inactive', ...);
it('device revoke confirms in page', ...);
it('non-admin cannot open /admin', ...);
```

- [ ] **Step 2: Run karein:** `pnpm --filter web test admin`. Expected: FAIL.
- [ ] **Step 3: Admin pages aur `apps/web/vercel.json` likhein.**
- [ ] **Step 4: Verify karein:** `pnpm --filter web test` poora PASS. Vercel staging par browser mein seed user se login, ek invite, `/v/<token>` par registration aur QR dikhna chahiye. `/v/<token>` page refresh karne par 404 nahi aana chahiye, `curl -I` mein `Referrer-Policy: no-referrer` dikhe, aur desk ka live update Render API se chale. Allowed list ke bahar wale domain se API call CORS par fail ho.
- [ ] **Step 5: Commit:** `git commit -am "feat(web): admin screens and Vercel deploy config"`
