# Visitor System Phase 1: Mobile App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ek role-based mobile app: Guard QR scan aur walk-in kare, Employee invite aur approve kare.

**Architecture:** `apps/mobile` ek Expo (React Native) app hai. Login ke baad role ke hisaab se Guard ya Host screens khulti hain. API `@visitor/shared` ke client se, tokens SecureStore mein, push Expo notifications se.

**Tech Stack:** Expo, Expo Router, expo-camera, expo-image-manipulator, expo-notifications, expo-secure-store, TanStack Query, socket.io-client, jest-expo + React Native Testing Library, EAS Build.

**Spec:** `docs/design/visitor-bsm-design.html`

**Depends on:** `2026-11-05-visitor-phase1-backend.md` poora ho chuka ho, khaas kar Task 12 (`createApiClient`).

## Global Constraints

- Backend plan ke Global Constraints yahan bhi lagu hain.
- Ek hi app, do roles. Guard ko Host ki screens nahi dikhengi, aur ulta bhi.
- Android pehli priority. iOS build bhi chalna chahiye.
- Gate par normal QR entry 30 second se kam mein ho.
- **Phase 1 mein offline mode nahi hai.** Internet band ho to app saaf bataye aur guard paper register par likhe. Offline sync Phase 2 mein aayega.
- Photos cache mein save nahi hongi aur compress hokar 200 KB tak upload hongi.
- UI copy Hinglish mein, bade buttons, guard ko dhoop mein aur ek haath se use karna hai.

## Review Focus

1. Camera ki permission mana kar di: saaf message, settings ka raasta, aur manual check-in ka option. Test: Task 2.
2. Camera ek QR ko second mein kai baar padhe: sirf ek API call. Test: Task 2.
3. Scan ke dauran network toote: same `clientEventId` se retry, doosri entry nahi. Fail ho to "Entry hui ya nahi, pata nahi" jaisa saaf message. Test: Task 2.
4. App band hote hue approval push par tap: sahi visit khule. Pehle hi decide ho chuka ho to status dikhe. Test: Task 5.
5. Guard ka device revoke ho jaye: agli request par login screen. Test: Task 1.

---

### Task 1: App skeleton, login, push registration

**Files:**
- Create: `apps/mobile/` (Expo app), `src/api.ts`, `src/auth/AuthProvider.tsx`, `src/auth/secureTokens.ts`, `src/notifications/registerPush.ts`, `app/_layout.tsx`, `app/login.tsx`, `app/(guard)/_layout.tsx`, `app/(host)/_layout.tsx`
- Test: `apps/mobile/src/auth/auth.test.tsx`

**Interfaces:**
- Consumes: `createApiClient`, `Role`, `POST /devices/push-token`
- Produces: `useApi(): ApiClient`, `useAuth(): {user, login, logout}`, `secureTokens: { get(), set() }`
- Routing: `guard` → `(guard)`, `employee` → `(host)`. `reception` → `(guard)`. `security`, `admin` → "Yeh account web par use karein" screen.

- [ ] **Step 1: Failing tests likhein**

```tsx
it('OTP login routes guard to guard home', ...);
it('employee goes to host home', ...);
it('admin sees use-web message', ...);
it('tokens persist across app restart', ...);
it('revoked device: next request returns to login, tokens cleared', ...);
it('push permission denied does not block login', ...);
```

- [ ] **Step 2: Run karein:** `pnpm --filter mobile test auth`. Expected: FAIL.
- [ ] **Step 3: App, auth aur push registration likhein.** pnpm monorepo ke liye `metro.config.js` mein workspace root add karein.
- [ ] **Step 4: Run karein:** `pnpm --filter mobile test auth`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat(mobile): app shell, OTP login and push registration"`

### Task 2: Guard: QR scan

**Files:**
- Create: `apps/mobile/app/(guard)/index.tsx`, `src/guard/ScannerView.tsx`, `ScanResult.tsx`, `createScanGate.ts`, `scanWithRetry.ts`, `useGate.ts`
- Test: `apps/mobile/src/guard/scan.test.tsx`, `createScanGate.test.ts`, `scanWithRetry.test.ts`

**Interfaces:**
- Consumes: `gate.scan`, `ApiError`, `NetworkError`
- Produces: `createScanGate(cooldownMs = 3000): { accept(value: string, now: number): boolean }`
- Produces: `scanWithRetry(api, req): Promise<{kind:'ok', data} | {kind:'rejected', error: ApiError} | {kind:'network'}>`. `clientEventId` (UUID) ek scan ke liye ek hi rehta hai, max 2 retry.
- Produces: `useGate(): {gateId, setGate}`. Guard ek baar gate chunta hai, SecureStore mein yaad rehta hai.
- Screen: bada IN / OUT toggle. Result full-screen: success par visitor ki photo, naam, host (photo match ke liye). Error par server ka `message`.

- [ ] **Step 1: Failing tests likhein**

```ts
it('same value within cooldown is rejected', ...);
it('same value after cooldown accepted; different value accepted at once', ...);
it('retries network error with same clientEventId', ...);
it('does not retry ApiError', ...);
it('returns network after 2 retries', ...);
```
```tsx
it('success shows photo, name, host', ...);
it('ALREADY_CHECKED_IN shows time and gate', ...);
it('PASS_EXPIRED shows server message and walk-in button', ...);
it('network result shows "Entry confirm nahi hui. Dobara scan karein." ', ...);
it('camera denied shows settings link and manual check-in', ...);
it('mode OUT sends mode OUT', ...);
```

- [ ] **Step 2: Run karein:** `pnpm --filter mobile test scan`. Expected: FAIL.
- [ ] **Step 3: Scanner aur result screens likhein.** `CameraView` `barcodeScannerSettings: {barcodeTypes: ['qr']}` ke saath. Result dikhte waqt scanning band rahe.
- [ ] **Step 4: Run karein:** `pnpm --filter mobile test scan`. Expected: PASS.
- [ ] **Step 5: Device par check karein:** Android phone par web pass ka QR scan, IN phir OUT, dono 30 second se kam mein. Phir commit: `git commit -am "feat(mobile): guard QR scan with safe retry"`

### Task 3: Guard: walk-in

**Files:**
- Create: `apps/mobile/app/(guard)/walk-in.tsx`, `src/guard/WalkInForm.tsx`, `WaitingForHost.tsx`, `capturePhoto.ts`, `src/live/useLiveVisit.ts`
- Test: `apps/mobile/src/guard/walkin.test.tsx`

**Interfaces:**
- Consumes: `gate.visitorLookup`, `gate.walkInOtp`, `gate.walkIn`, `uploads.uploadPhoto`, `users.searchHosts`, `visits.get`, `visits.checkIn`, socket `/live`
- Produces: `capturePhoto(): Promise<{uri}>`, expo-image-manipulator se 1024px aur ≤200 KB JPEG.
- Produces: `useLiveVisit(visitId): { visit, connected }`. Socket event par refetch, socket band ho to 5 second polling (visitor gate par khada hai, isliye desk se tez).
- Steps: Number → OTP → details aur consent checkbox → host chunein → intezaar screen (timer ke saath) → result. Consent copy: "Visitor ko bata diya gaya hai ki details visitor record ke liye save hongi."

- [ ] **Step 1: Failing tests likhein**

```tsx
it('known visitor prefilled after lookup', ...);
it('new visitor needs name and photo', ...);
it('submit blocked without consent', ...);
it('wrong OTP stays on OTP step with message', ...);
it('waiting screen shows approved via socket, then Check-in button', ...);
it('polls every 5s when socket down', ...);
it('rejected shows reason, no check-in button', ...);
it('after 5 min shows "Reception host ko call kar raha hai"', ...);
it('resend OTP disabled for 30s', ...);
it('check-in reuses clientEventId on retry', ...);
```

- [ ] **Step 2: Run karein:** `pnpm --filter mobile test walkin`. Expected: FAIL.
- [ ] **Step 3: Flow likhein.**
- [ ] **Step 4: Run karein:** `pnpm --filter mobile test walkin`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat(mobile): guard walk-in with live host approval"`

### Task 4: Guard: andar kaun hai

**Files:**
- Create: `apps/mobile/app/(guard)/inside.tsx`, `src/guard/InsideList.tsx`
- Test: `apps/mobile/src/guard/inside.test.tsx`

**Interfaces:**
- Consumes: `dashboard.live`, `visits.checkOut`, socket `/live`
- Screen: `inside` aur `expected` list, naam search, QR ke bina manual check-out.

- [ ] **Step 1: Failing tests likhein**

```tsx
it('lists inside visitors with photo and host', ...);
it('search filters by name', ...);
it('manual check-out confirms, then removes the row', ...);
it('check-out conflict shows message and refreshes', ...);
it('list refreshes on visit.updated', ...);
```

- [ ] **Step 2: Run karein:** `pnpm --filter mobile test inside`. Expected: FAIL.
- [ ] **Step 3: Screen likhein.**
- [ ] **Step 4: Run karein:** `pnpm --filter mobile test inside`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat(mobile): guard inside list and manual check-out"`

### Task 5: Host: invite aur approval

**Files:**
- Create: `apps/mobile/app/(host)/index.tsx`, `app/(host)/invite.tsx`, `app/(host)/visits/[id].tsx`, `app/(host)/settings.tsx`, `src/notifications/handleTap.ts`
- Test: `apps/mobile/src/host/host.test.tsx`, `src/notifications/handleTap.test.ts`

**Interfaces:**
- Consumes: `visits.create`, `visits.list`, `visits.get`, `visits.approve`, `visits.reject`, `visits.cancel`, `visits.resendInvite`, `me.update`, `users.searchHosts`
- Consumes (backend Task 7 se): push `data: { visitId, template }`
- Produces: `routeForNotification(data): string`, `APPROVAL_*` aur `VISITOR_ARRIVED` dono → `/(host)/visits/<id>`.

- [ ] **Step 1: Failing tests likhein**

```tsx
it('routeForNotification maps to visit page; unknown returns home', ...);
it('cold-start tap opens the visit after auth loads', ...);
it('approve from visit screen updates status', ...);
it('already decided shows status, no buttons', ...);
it('second approver conflict shows current status from server', ...);
it('invite validates phone and time', ...);
it('delegate can be set from settings', ...);
```

- [ ] **Step 2: Run karein:** `pnpm --filter mobile test host`. Expected: FAIL.
- [ ] **Step 3: Screens aur notification handling likhein.**
- [ ] **Step 4: Run karein:** `pnpm --filter mobile test host`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat(mobile): host invites and push approvals"`

### Task 6: Builds aur poora end-to-end check

**Files:**
- Create: `apps/mobile/eas.json`, `apps/mobile/app.config.ts`, `docs/phase1-acceptance.md`

**Interfaces:**
- Values: Build profiles `preview` (internal APK) aur `production`. `API_URL` profile ke hisaab se. Camera aur notification permission ka text `app.config.ts` mein Hinglish mein.

- [ ] **Step 1: `docs/phase1-acceptance.md` mein checklist likhein:** design ke workflow A, B, C aur Phase 1 wale exception cases, har ek ka expected result.
- [ ] **Step 2: Config likhein aur build chalayein:** `eas build --profile preview --platform android`. Expected: installable APK.
- [ ] **Step 3: Staging par asli phones ke saath poori checklist chalayein** (guard phone, host phone, visitor phone, desk browser). Expected: har item pass. Fail wale items ko fix karein ya issue likhein.
- [ ] **Step 4: Commit:** `git add . && git commit -m "chore(mobile): EAS builds and Phase 1 acceptance checklist"`
