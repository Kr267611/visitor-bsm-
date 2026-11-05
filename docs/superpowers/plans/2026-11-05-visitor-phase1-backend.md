# Visitor System Phase 1: Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Invite, walk-in, approval, signed QR, check-in/out, live dashboard, Push + SMS aur audit log wala NestJS API, jis par web aur mobile app ban sakein.

**Architecture:** pnpm monorepo mein ek modular monolith (`apps/api`) aur shared types/client (`packages/shared`). Har status change ek hi service (`VisitLifecycleService`) se guzarta hai, jo ek transaction mein visit update, audit event aur outbox entry likhta hai. API aur BullMQ worker Phase 1 mein ek hi process mein chalte hain.

**Tech Stack:** TypeScript, Node 22+, NestJS, Prisma, PostgreSQL 16+, Redis + BullMQ, Socket.IO, S3-compatible storage (local par MinIO, production bucket Task 13 mein), Jest + Supertest. Production database Render Postgres, Singapore region.

**Spec:** `docs/design/visitor-bsm-design.html` (live: https://claude.ai/artifact/BGsH1ufXR7usY5nd5vwQ1T)

**Plan order:** Pehle yeh plan. Uske baad `2026-11-05-visitor-phase1-web.md` aur `2026-11-05-visitor-phase1-mobile.md`, dono parallel chal sakte hain.

## Pehle se chahiye (developer ke bahar ka kaam)

- SMS gateway account aur **DLT registration** (entity + har SMS template). Isme hafte lag sakte hain, isliye Task 1 ke saath shuru karein. Tab tak `SMS_PROVIDER=console` chalega.
- Render account: API, Postgres aur Redis ke liye region Singapore (Render par India region nahi hai). Domain aur Expo account bhi.
- Vercel account web app ke liye. Yeh company ka kaam hai, isliye plan Vercel ke commercial use ke rules ke hisaab se chunein.
- Photos aur backup ke liye ek S3-compatible bucket, kyunki Render par object storage nahi hai. Provider Task 13 se pehle final hoga, code par asar nahi padega.

## Global Constraints

- Scope sirf design ka Phase 1. **Phase 1 mein nahi:** WhatsApp, watchlist, offline sync, badge print, overstay alert, reports/CSV, emergency list, auto-delete job, app PIN, SSO, group invite API, admin se timer settings.
- Assumptions (design ke): ek company, 1–5 sites, 50–500 visitors roz.
- Hosting: API, Postgres aur Redis Render par, region Singapore. Web app Vercel par. Ek hi instance (`numInstances: 1`). Visitors ka personal data India ke bahar Singapore mein rahega, launch se pehle company se confirm karein.
- Browsers aur phones sirf hamare API se baat karenge. Photo upload aur download bhi API se, bucket private, storage keys sirf server par.
- Render plan stage ke hisaab se. Development aur staging: Free web service + Free Postgres + Free Key Value. Production: paid instance `0.5c-512mb` + paid Postgres + Key Value 256 MB, memory kam pade to `1c-2g`. Free production ke liye nahi, kyunki Render khud mana karta hai: service 15 minute baad so jati hai, uthne mein lagbhag ek minute leti hai, kabhi bhi restart ho sakti hai, Free Key Value restart par saara data kho deta hai, aur Free Postgres 30 din baad expire ho jata hai aur uska backup nahi hota. Asli visitors ka data kabhi free database par nahi.
- Gate scan ka response staging par India se p95 2 second ke andar ho, kyunki API Singapore mein hai.
- Poora ID number kabhi save nahi hoga. Sirf `id_type` aur `id_last4` (`/^\d{4}$/`).
- QR mein koi naam ya phone nahi. Format `v1.<base64url payload>.<base64url signature>`, algorithm Ed25519.
- `visit_events` append-only. DB trigger update aur delete ko rokega.
- Consent ke bina visitor record complete nahi hoga. `delete_after = consent_at + 180 din`.
- Phone hamesha E.164 (`+919876543210`) mein save hoga.
- Galat status transition API se reject hoga.
- Times DB mein UTC, user ko dikhne wale messages `Asia/Kolkata` mein.
- Saare error responses ka shape: `{ "error": ErrorCode, "message": string, ...extra }`. `message` Hinglish mein, jaise design mein hai.
- Timer defaults: reminder 90s, backup person 180s, reception call task 300s (env se badle ja sakte hain).

## Design se jaan-boojh kar farak

1. `POST /gate/scan` mein ek extra field `mode: "IN" | "OUT"` hai. Design mein same QR dobara scan par "already checked in" bhi hai aur exit scan bhi. Dono tabhi chal sakte hain jab guard ka mode pata ho.
2. Push Expo push service se jayega (Android par yeh FCM use karta hai), isliye `devices.fcm_token` ka naam `push_token` hai.
3. Login Phase 1 mein sabke liye phone OTP. SSO tab jab company ka provider confirm ho.
4. Extra columns: `visits.invite_token_hash`, `visits.reception_call_requested_at`, `visitors.consent_version`, `outbox.vars`. Extra table: `refresh_tokens`.
5. `PENDING_APPROVAL` bhi `valid_to` ke baad `EXPIRED` ho sakta hai, warna chhode gaye walk-ins hamesha pending rahenge.
6. `GET /gate/today` Phase 2 mein aayega, kyunki woh offline cache ke liye hai. Phase 1 mein guard app `GET /dashboard/live` use karegi.
7. Design mein photos signed URL se seedha storage par jati thin. Ab upload aur download dono hamare API se honge, taaki storage provider badalne par apps par asar na pade. Isse server par thoda load badhega, par 500 visitors roz par yeh chhota hai.

## Review Focus

1. Ek hi number alag format mein (`98765 43210`, `+91-98765-43210`, `09876543210`): ek hi visitor banna chahiye. Test: Task 1, Task 8.
2. Pass ka time khatam hone ke baad exit scan: check-out hona chahiye, visitor gate par phansna nahi chahiye. Test: Task 9.
3. Do gates par same QR ek saath, ya network retry mein same `clientEventId`: sirf ek check-in, retry ko wahi success. Test: Task 9.
4. Visitor ne form submit do baar dabaya: dono baar wahi pass, koi error nahi. Test: Task 8.
5. SMS gateway down: check-in phir bhi ho, message baad mein retry ho. Test: Task 7, Task 9.

---

### Task 1: Monorepo aur shared rules

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.editorconfig`
- Create: `packages/shared/package.json` (name `@visitor/shared`), `packages/shared/src/index.ts`, `src/status.ts`, `src/phone.ts`, `src/types.ts`
- Test: `packages/shared/src/status.test.ts`, `src/phone.test.ts`

**Interfaces:**
- Produces: `VisitStatus` = `INVITED | PENDING_APPROVAL | APPROVED | REJECTED | CHECKED_IN | CHECKED_OUT | CANCELLED | EXPIRED`
- Produces: `VisitAction` = `REGISTER | APPROVE | REJECT | CHECK_IN | CHECK_OUT | CANCEL | EXPIRE`
- Produces: `Role` = `guard | employee | reception | security | admin`
- Produces: `nextStatus(from: VisitStatus, action: VisitAction): VisitStatus | null`
- Produces: `normalizeIndianPhone(input: string): string | null`
- Produces: `ErrorCode` union, shuruaat `INVALID_PASS | WRONG_SITE | PASS_NOT_YET_VALID | PASS_EXPIRED | ALREADY_CHECKED_IN | NOT_CHECKED_IN | INVALID_TRANSITION | INVITE_EXPIRED | CONSENT_REQUIRED | INVALID_OTP | OTP_RATE_LIMITED | FORBIDDEN | NOT_FOUND | VALIDATION_FAILED`

- [ ] **Step 1: `git init` karein, workspace files banayein, phir failing tests likhein**

```ts
it.each([
  ['INVITED','REGISTER','APPROVED'], ['INVITED','CANCEL','CANCELLED'], ['INVITED','EXPIRE','EXPIRED'],
  ['PENDING_APPROVAL','APPROVE','APPROVED'], ['PENDING_APPROVAL','REJECT','REJECTED'],
  ['PENDING_APPROVAL','CANCEL','CANCELLED'], ['PENDING_APPROVAL','EXPIRE','EXPIRED'],
  ['APPROVED','CHECK_IN','CHECKED_IN'], ['APPROVED','CANCEL','CANCELLED'], ['APPROVED','EXPIRE','EXPIRED'],
  ['CHECKED_IN','CHECK_OUT','CHECKED_OUT'],
])('%s + %s = %s', (from, action, to) => expect(nextStatus(from, action)).toBe(to));

it.each([['REJECTED','CHECK_IN'],['CHECKED_OUT','CHECK_IN'],['CHECKED_IN','EXPIRE'],['CHECKED_IN','CANCEL'],['INVITED','CHECK_IN']])
  ('%s + %s blocked', (from, action) => expect(nextStatus(from, action)).toBeNull());

it.each(['98765 43210','+91-98765-43210','09876543210','919876543210','+919876543210'])
  ('%s normalizes', (p) => expect(normalizeIndianPhone(p)).toBe('+919876543210'));
it.each(['12345','0000000000','5876543210','abc',''])('%s rejected', (p) => expect(normalizeIndianPhone(p)).toBeNull());
```

- [ ] **Step 2: Run karein, fail hona chahiye:** `pnpm --filter @visitor/shared test`. Expected: FAIL, functions not defined.
- [ ] **Step 3: `nextStatus` (lookup table) aur `normalizeIndianPhone` likhein.** Valid mobile number 10 digit ka hota hai aur 6–9 se shuru hota hai.
- [ ] **Step 4: Run karein:** `pnpm --filter @visitor/shared test`. Expected: PASS.
- [ ] **Step 5: Commit:** `git add . && git commit -m "feat: monorepo with shared visit status and phone rules"`

### Task 2: API skeleton, database, audit trigger

**Files:**
- Create: `docker-compose.yml` (postgres, redis, minio), `.env.example`
- Create: `apps/api/` Nest app, `apps/api/prisma/schema.prisma`, migration `immutable_visit_events`
- Create: `apps/api/src/health/health.controller.ts`, `apps/api/src/prisma/prisma.service.ts`, `apps/api/src/common/api-error.filter.ts`
- Test: `apps/api/test/setup.ts` (test DB `visitor_test`, har test se pehle truncate), `apps/api/test/foundation.e2e.ts`

**Interfaces:**
- Produces: Prisma models design ke "Database design" section ke mutabik: `Site, Gate, User, Visitor, Visit, VisitEvent, Outbox, Device`, plus `RefreshToken(id, user_id, device_id, token_hash, expires_at, revoked_at)`. `Visit.status` enum `VisitStatus` se match kare. Phase 1 mein `watchlist` table nahi.
- Produces: Postgres sequence `visit_code_seq`, jisse `VIS-2026-00412` format ka code banega.
- Produces: `createTestApp(): Promise<{ app, prisma, sms: FakeSmsProvider }>` test helper. `FakeSmsProvider` Task 7 mein aayega, tab tak `sms` undefined.
- Produces: `ApiException(status: number, code: ErrorCode, message: string, extra?: object)`, filter isse standard error shape mein badalta hai.

- [ ] **Step 1: Failing tests likhein**

```ts
it('GET /health returns ok with db and redis', async () => {
  const res = await request(app.getHttpServer()).get('/health').expect(200);
  expect(res.body).toEqual({ status: 'ok', db: 'up', redis: 'up' });
});
it('visit_events rejects update', async () => {
  const e = await seedVisitEvent(prisma);
  await expect(prisma.$executeRaw`UPDATE visit_events SET type='X' WHERE id=${e.id}`).rejects.toThrow(/append-only/);
});
it('visit_events rejects delete', async () => {
  const e = await seedVisitEvent(prisma);
  await expect(prisma.$executeRaw`DELETE FROM visit_events WHERE id=${e.id}`).rejects.toThrow(/append-only/);
});
it('duplicate client_event_id rejected', async () => { /* same client_event_id twice => unique violation */ });
```

- [ ] **Step 2: Run karein:** `docker compose up -d && pnpm --filter api test:e2e`. Expected: FAIL.
- [ ] **Step 3: Schema, migration, health controller aur error filter likhein.** Trigger `BEFORE UPDATE OR DELETE` par `RAISE EXCEPTION 'visit_events is append-only'`. Indexes: `visits(site_id, status)`, `visits(host_id, valid_from)`.
- [ ] **Step 4: Run karein:** `pnpm --filter api test:e2e`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat(api): schema, health check and append-only audit log"`

### Task 3: Login, roles, devices

**Files:**
- Create: `apps/api/src/auth/` (`auth.controller.ts`, `auth.service.ts`, `otp.service.ts`, `jwt.guard.ts`, `roles.guard.ts`, `roles.decorator.ts`)
- Create: `apps/api/src/devices/devices.controller.ts`
- Test: `apps/api/test/auth.e2e.ts`

**Interfaces:**
- Produces: `POST /auth/otp/request {phone}`, 204, unknown number par bhi 204 (par SMS nahi), taaki pata na chale kaun employee hai.
- Produces: `POST /auth/otp/verify {phone, otp, deviceName}` → `{ accessToken, refreshToken, user: {id, name, role, siteId}, deviceId }`
- Produces: `POST /auth/refresh {refreshToken}` → naye dono tokens (rotation). `POST /auth/logout`.
- Produces: `POST /devices/push-token {pushToken}`, `GET /admin/devices`, `POST /admin/devices/:id/revoke` (admin, security).
- Produces: `OtpService.request(phone, template): Promise<void>` aur `OtpService.verify(phone, otp): Promise<boolean>`. Task 10 bhi inhe use karega.
- Produces: `@Roles(...Role[])`, `@CurrentUser() → {id, role, siteId, deviceId}`
- Values: OTP 6 digit, 5 min expiry, Redis mein hash, 5 galat try ke baad invalid, 10 min mein max 3 request per phone. Access token 15 min, refresh token 30 din, DB mein sirf hash.

- [ ] **Step 1: Failing tests likhein**

```ts
it('correct OTP logs in', ...);            // verify => 200, accessToken present
it('6th wrong attempt blocks even correct OTP', ...);   // 401 INVALID_OTP
it('4th request in 10 min rate limited', ...);          // 429 OTP_RATE_LIMITED
it('unknown phone returns 204, sends no SMS', ...);     // sms.sent.length === 0
it('inactive user cannot log in', ...);                 // 401
it('old refresh token rejected after rotation', ...);   // 401
it('revoked device cannot refresh', ...);               // 401
it('@Roles blocks wrong role', ...);                    // guard on admin route => 403 FORBIDDEN
```

- [ ] **Step 2: Run karein:** `pnpm --filter api test:e2e auth`. Expected: FAIL.
- [ ] **Step 3: Auth module likhein.** OTP SMS sidha `SmsProvider` se jayega, outbox se nahi, taaki OTP database mein na rahe. Task 7 se pehle `SmsProvider` ka interface aur `FakeSmsProvider`/console version yahin banayein (`apps/api/src/notifications/sms.provider.ts`).
- [ ] **Step 4: Run karein:** `pnpm --filter api test:e2e auth`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat(api): OTP login, JWT rotation, roles and device revoke"`

### Task 4: Admin APIs aur seed

**Files:**
- Create: `apps/api/src/admin/` (`sites`, `gates`, `users` controllers), `apps/api/src/me/me.controller.ts`, `apps/api/prisma/seed.ts`
- Test: `apps/api/test/admin.e2e.ts`

**Interfaces:**
- Produces: `/admin/sites`, `/admin/gates`, `/admin/users`: GET, POST, PATCH (sirf `admin`). Delete nahi, `is_active=false` karein, taaki audit history na toote.
- Produces: `GET /me`, `PATCH /me {delegateId}`.
- Produces: `GET /users/hosts?q=`: guard/reception ke liye naam se search, sirf `{id, name, department}` aur sirf apni site.
- Produces: seed: 1 site, 1 gate, har role ka ek test user (`.env.example` mein test numbers).

- [ ] **Step 1: Failing tests likhein**

```ts
it('admin creates user with normalized phone', ...);    // phone === '+919876543210'
it('duplicate phone rejected', ...);                    // 422 VALIDATION_FAILED
it('non-admin cannot list users', ...);                 // 403
it('delegate must be active user at same site', ...);   // 422
it('cannot set self as delegate', ...);                 // 422
it('host search hides phone and other sites', ...);     // no phone key; other site absent
```

- [ ] **Step 2: Run karein:** `pnpm --filter api test:e2e admin`. Expected: FAIL.
- [ ] **Step 3: Controllers aur seed likhein.**
- [ ] **Step 4: Run karein:** `pnpm --filter api test:e2e admin`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat(api): admin management, delegate setting and seed"`

### Task 5: Signed QR pass

**Files:**
- Create: `apps/api/src/passes/pass.service.ts`
- Test: `apps/api/src/passes/pass.service.spec.ts`

**Interfaces:**
- Produces: `PassService.sign(p: {visitId: string; siteId: string; validFrom: Date; validTo: Date}): string`
- Produces: `PassService.verify(token: string): PassPayload | null`. Payload JSON keys: `v` (visit id), `s` (site id), `f`, `t` (epoch seconds).
- Env: `QR_PRIVATE_KEY`, `QR_PUBLIC_KEY` (PEM, base64 mein). Script: `apps/api/scripts/gen-qr-keys.ts`.

- [ ] **Step 1: Failing tests likhein**

```ts
it('sign then verify returns payload', ...);
it('token starts with v1.', ...);
it('payload has no name or phone', () => {
  const body = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  expect(Object.keys(body).sort()).toEqual(['f','s','t','v']);
});
it('tampered payload returns null', ...);
it('other key signature returns null', ...);
it.each(['', 'abc', 'v1.x', 'v2.a.b', 'v1.!!!.???'])('garbage %s returns null', ...);
```

- [ ] **Step 2: Run karein:** `pnpm --filter api test pass.service`. Expected: FAIL.
- [ ] **Step 3: `node:crypto` ke `sign`/`verify` se likhein.** `verify` kabhi throw na kare.
- [ ] **Step 4: Run karein:** `pnpm --filter api test pass.service`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat(api): Ed25519 signed visitor pass"`

### Task 6: Visit lifecycle (ek hi darwaza)

**Files:**
- Create: `apps/api/src/visits/visit-lifecycle.service.ts`, `apps/api/src/visits/errors.ts`
- Test: `apps/api/test/lifecycle.e2e.ts`

**Interfaces:**
- Produces: yeh service hi `visits.status` badal sakti hai:

```ts
apply(input: {
  visitId: string; action: VisitAction; actorId: string | null;
  gateId?: string; deviceId?: string; clientEventId?: string;
  patch?: Partial<Pick<Visit,'checkedInAt'|'checkedOutAt'|'inGateId'|'outGateId'>>;
  notify?: OutboxDraft[]; meta?: object;
}): Promise<Visit>   // throws InvalidTransitionError(current: VisitStatus)
```

- Produces: `recordEvent(visitId, type, actorId, meta?)`: bina status change wale events (`CREATED`, `REMINDER_SENT`, `RECEPTION_CALL_REQUESTED`).
- Produces: `OutboxDraft = { channel: 'PUSH'|'SMS'; template: TemplateKey; recipient: string; vars: Record<string,string>; visitId?: string }`. `PUSH` ka recipient user id, `SMS` ka phone.
- Produces: commit ke baad EventEmitter2 event `visit.updated` `{visitId, siteId, status}`. Task 11 isse sunega.

- [ ] **Step 1: Failing tests likhein**

```ts
it('applies transition, writes event, writes outbox in one tx', ...);
it('invalid transition throws and writes nothing', ...);
it('outbox insert failure rolls back status and event', ...);
it('parallel apply: one wins, other gets InvalidTransitionError', async () => {
  const r = await Promise.allSettled([apply(checkIn), apply(checkIn)]);
  expect(r.filter(x => x.status === 'fulfilled')).toHaveLength(1);
  expect(await countEvents(visitId, 'CHECK_IN')).toBe(1);
});
it('emits visit.updated only after commit', ...);
```

- [ ] **Step 2: Run karein:** `pnpm --filter api test:e2e lifecycle`. Expected: FAIL.
- [ ] **Step 3: `apply` likhein.** Transaction mein `updateMany({where:{id, status: from}})`, jahan `from` pehle padha gaya status hai. Count 0 ho to dobara padh kar `InvalidTransitionError` throw karein. Yahi race rokta hai.
- [ ] **Step 4: Run karein:** `pnpm --filter api test:e2e lifecycle`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat(api): transactional visit lifecycle service"`

### Task 7: Notifications (outbox worker)

**Files:**
- Create: `apps/api/src/notifications/` (`templates.ts`, `outbox.worker.ts`, `msg91-sms.provider.ts`, `console-sms.provider.ts`, `fake-sms.provider.ts`, `expo-push.provider.ts`)
- Test: `apps/api/test/outbox.e2e.ts`

**Interfaces:**
- Consumes: `OutboxDraft` (Task 6), `SmsProvider` (Task 3)
- Produces: `TemplateKey` aur exact copy:

| Key | Channel | Text |
|---|---|---|
| `INVITE_LINK` | SMS | `{hostName} ne aapko {siteName} bulaya hai. Apni details bharein: {link}` |
| `PASS_READY` | SMS | `Aapka visitor pass taiyaar hai: {link}` |
| `VISITOR_ARRIVED` | PUSH | `{visitorName} {gateName} par aa gaye hain.` |
| `APPROVAL_REQUEST` | PUSH | `{visitorName} ({company}) aapse milne gate par hain. Approve ya reject karein.` |
| `APPROVAL_REMINDER` | PUSH | `{visitorName} abhi bhi gate par intezaar kar rahe hain.` |
| `LOGIN_OTP` | SMS | `Aapka login OTP {otp} hai. 5 minute mein expire hoga.` |
| `WALKIN_OTP` | SMS | `Gate entry ka OTP {otp} hai. Aapki details visitor record ke liye save hongi: {privacyLink}` |

- Produces: `OutboxWorker.tick(now = new Date()): Promise<number>`, har 5 second BullMQ repeatable job se.
- Values: `FOR UPDATE SKIP LOCKED`, batch 50, backoff `30s × 2^attempts`, 5 attempts ke baad `FAILED` aur error log. Har push ke saath `data: { visitId, template }` jayega, taaki tap par sahi visit khule. `PUSH` jis user ka koi active device na ho ya jiski push fail ho, usko same text SMS par jayega, approval templates mein `${PUBLIC_WEB_URL}/my/visits/<id>` link ke saath.

- [ ] **Step 1: Failing tests likhein**

```ts
it('sends pending SMS and marks SENT with provider id', ...);
it('provider failure sets next_retry_at +30s, attempts 1', ...);
it('not retried before next_retry_at', ...);
it('5th failure marks FAILED', ...);
it('two ticks in parallel send once', ...);
it('push with no device falls back to SMS', ...);
it('unknown template var throws at enqueue', ...);
```

- [ ] **Step 2: Run karein:** `pnpm --filter api test:e2e outbox`. Expected: FAIL.
- [ ] **Step 3: Worker aur providers likhein.** `SMS_PROVIDER` env (`console | msg91`) se provider chune.
- [ ] **Step 4: Run karein:** `pnpm --filter api test:e2e outbox`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat(api): outbox worker with SMS and push delivery"`

### Task 8: Invite flow aur visitor page ke APIs

**Files:**
- Create: `apps/api/src/visits/visits.controller.ts`, `visits.service.ts`, `public-invites.controller.ts`, `invite-tokens.ts`
- Create: `apps/api/src/storage/storage.service.ts`, `uploads.controller.ts`
- Test: `apps/api/test/invites.e2e.ts`

**Interfaces:**
- Consumes: `VisitLifecycleService`, `PassService`, `normalizeIndianPhone`
- Produces: `POST /visits {visitorName, visitorPhone, validFrom, validTo, purpose}` → `{id, code, status}`. Roles: employee, reception, admin. Host current user, site host ki.
- Produces: `GET /visits?date=&status=&scope=mine|site`, `GET /visits/:id` (host, delegate, ya us site ka staff), `POST /visits/:id/cancel`, `POST /visits/:id/resend-invite` (naya token, purana link band).
- Produces: `GET /public/invites/:token` → `{status, visitorName, hostName, siteName, validFrom, validTo, pass: string | null}`. `pass` sirf `APPROVED` aur `CHECKED_IN` par.
- Produces: `POST /public/invites/:token/photo` (multipart, field `photo`) → `{key}`
- Produces: `POST /public/invites/:token/register {name, company?, photoKey, idType?, idLast4?, consent}` → same shape as GET.
- Produces: `POST /uploads/photo` (staff, Task 10 ke liye, multipart) → `{key}`
- Produces: `StorageService.put(key: string, body: Buffer, contentType: string): Promise<void>` (`@aws-sdk/client-s3`, `S3_ENDPOINT` se MinIO ya production bucket).
- Produces: `StorageService.photoUrl(key: string, seconds = 300): string` → `${API_URL}/photos/<signed token>`, aur `GET /photos/:token` jo photo stream karta hai.
- Values: Invite token 32 random bytes (base64url), DB mein SHA-256 hash, link `${PUBLIC_WEB_URL}/v/<token>`. `validTo` `validFrom` ke baad aur max 24 ghante door. Photo: API se upload, `image/jpeg` only (file ke magic bytes bhi check), max 1 MB, key `visitors/<visitId>/<uuid>.jpg`. `consent_version` env `CONSENT_VERSION`. Public routes par throttle 20 req/min per IP.

- [ ] **Step 1: Failing tests likhein**

```ts
it('invite creates visit INVITED, CREATED event and INVITE_LINK outbox', ...);
it('three phone formats map to one visitor row', ...);        // Review Focus 1
it('invite does not overwrite existing visitor name', ...);
it('validTo before validFrom rejected', ...);                 // 422
it('window over 24h rejected', ...);                          // 422
it('employee sees mine only; scope=site forbidden', ...);     // 403
it('unknown token 404 NOT_FOUND', ...);
it('register without consent 422 CONSENT_REQUIRED, stays INVITED', ...);
it('register sets APPROVED, consent_at, delete_after +180d, returns pass', ...);
it('double register returns same pass 200', ...);             // Review Focus 4
it('idLast4 "123456789012" rejected and never stored', ...);
it('photoKey of another visit rejected', ...);                // 422
it('photo over 1 MB rejected', ...);                          // 413
it('PNG renamed as .jpg rejected by magic bytes', ...);       // 422
it('photoUrl points to API host, not the storage host', ...);
it('expired photo token rejected', ...);                      // 401
it('register after validTo 410 INVITE_EXPIRED', ...);
it('cancelled visit GET has status CANCELLED, pass null', ...);
it('resend rotates token: old link 404', ...);
it('GET response has no visitor phone', ...);
```

- [ ] **Step 2: Run karein:** `pnpm --filter api test:e2e invites`. Expected: FAIL.
- [ ] **Step 3: Controllers aur services likhein.**
- [ ] **Step 4: Run karein:** `pnpm --filter api test:e2e invites`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat(api): invite flow, visitor registration and photo upload"`

### Task 9: Gate: scan, check-in, check-out

**Files:**
- Create: `apps/api/src/gate/gate.controller.ts`, `gate.service.ts`, `scan-messages.ts`
- Test: `apps/api/test/gate.e2e.ts`

**Interfaces:**
- Consumes: `PassService.verify`, `VisitLifecycleService.apply`, `StorageService.photoUrl`
- Produces: `POST /gate/scan {qr, gateId, mode: 'IN'|'OUT', clientEventId}`
- Success `200`: `{ result: 'CHECKED_IN'|'CHECKED_OUT', visitId, visitor: {name, company, photoUrl}, host, validTo }`
- Errors: `422 INVALID_PASS`, `422 WRONG_SITE`, `422 PASS_NOT_YET_VALID`, `422 PASS_EXPIRED` (message: `Yeh pass 4 Nov ke liye tha`), `409 ALREADY_CHECKED_IN {at, gate}`, `409 NOT_CHECKED_IN`, `409 INVALID_TRANSITION {status}`
- Produces: `POST /visits/:id/check-in {gateId, clientEventId}`, `POST /visits/:id/check-out {gateId, clientEventId}` (QR ke bina: walk-in aur phone band hone par).
- Values: Roles guard, reception. Gate user ki site ka hona chahiye. Check-in `valid_from` se 30 min pehle se allowed (`PASS_EARLY_GRACE_MIN=30`). Check-in par host ko `VISITOR_ARRIVED`.

- [ ] **Step 1: Failing tests likhein**

```ts
it('valid QR IN => CHECKED_IN, photoUrl present, host notified', ...);
it('garbage QR 422 INVALID_PASS', ...);
it('gate of other site 422 WRONG_SITE', ...);
it('guard of other site 403', ...);
it('60 min early 422 PASS_NOT_YET_VALID; 20 min early works', ...);
it('expired 422 PASS_EXPIRED with date in IST in message', ...);
it('second IN scan new eventId 409 ALREADY_CHECKED_IN with at and gate', ...);
it('same clientEventId replay returns original 200, one event', ...);        // Review Focus 3
it('two gates parallel: one 200, one 409, one event', ...);                  // Review Focus 3
it('OUT after validTo still checks out', ...);                               // Review Focus 2
it('OUT on not-checked-in 409 NOT_CHECKED_IN', ...);
it('REJECTED visit QR 409 INVALID_TRANSITION', ...);
it('check-in works with SMS provider failing', ...);                         // Review Focus 5
it('manual check-in records actor and gate in event', ...);
```

- [ ] **Step 2: Run karein:** `pnpm --filter api test:e2e gate`. Expected: FAIL.
- [ ] **Step 3: `GateService` likhein.** Sabse pehle `clientEventId` dekhein. Event mil jaye to usi visit ka current result lautayein.
- [ ] **Step 4: Run karein:** `pnpm --filter api test:e2e gate`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat(api): gate scan with idempotent check-in and check-out"`

### Task 10: Walk-in aur approval timers

**Files:**
- Create: `apps/api/src/approvals/approvals.controller.ts`, `approvals.service.ts`, `approval-timer.processor.ts`
- Modify: `apps/api/src/gate/gate.controller.ts` (walk-in routes)
- Test: `apps/api/test/walkin.e2e.ts`

**Interfaces:**
- Consumes: `OtpService` (Task 3), `VisitLifecycleService`, `PassService`, invite tokens (Task 8)
- Produces: `GET /gate/visitors/lookup?phone=` → `{found: false}` ya `{found: true, name, company, photoUrl}`
- Produces: `POST /gate/walk-ins/otp {phone}`, 204
- Produces: `POST /gate/walk-ins {phone, otp, name, company?, photoKey, hostId, purpose, gateId, consent, clientEventId}` → `{visitId, code, status: 'PENDING_APPROVAL'}`
- Produces: `POST /visits/:id/approve {note?}`, `POST /visits/:id/reject {reason?}`. Allowed: host, host ka delegate, us site ka reception/admin. Actor event mein save.
- Produces: `ApprovalTimerProcessor.process(job: {name: 'reminder'|'delegate'|'reception', data: {visitId}})`
- Values: Walk-in window `valid_from = now`, `valid_to = now + 4h`. Timers env `APPROVAL_REMINDER_SEC=90`, `APPROVAL_DELEGATE_SEC=180`, `APPROVAL_RECEPTION_SEC=300`. Approve par naya invite token aur visitor ko `PASS_READY` SMS, taaki exit scan ke liye QR ho.

- [ ] **Step 1: Failing tests likhein**

```ts
it('lookup returns known visitor, found:false for new', ...);
it('walk-in with wrong OTP 401, no visit created', ...);
it('walk-in without consent 422', ...);
it('walk-in => PENDING_APPROVAL, host gets APPROVAL_REQUEST, 3 jobs queued', ...);
it('host of other site rejected', ...);
it('host approves => APPROVED, PASS_READY queued', ...);
it('delegate approves; actor is delegate', ...);
it('unrelated employee 403', ...);
it('second approver after decision 409 INVALID_TRANSITION with status', ...);
it('reminder job sends APPROVAL_REMINDER only while pending', ...);
it('delegate job notifies delegate; no-op without delegate', ...);
it('reception job sets reception_call_requested_at', ...);
it('all jobs no-op after approval', ...);
it('reception approves on behalf; event shows reception actor', ...);
```

- [ ] **Step 2: Run karein:** `pnpm --filter api test:e2e walkin`. Expected: FAIL.
- [ ] **Step 3: Services likhein.** Jobs chalte waqt status dobara check karein. Faisla hone par `jobId` `<visitId>:<name>` se pending jobs hataayein.
- [ ] **Step 4: Run karein:** `pnpm --filter api test:e2e walkin`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat(api): walk-in entry with approval and escalation timers"`

### Task 11: Live updates, dashboard, expiry

**Files:**
- Create: `apps/api/src/live/live.gateway.ts`, `apps/api/src/dashboard/dashboard.controller.ts`, `apps/api/src/visits/expiry.job.ts`
- Test: `apps/api/test/live.e2e.ts`

**Interfaces:**
- Consumes: `visit.updated` event (Task 6)
- Produces: Socket.IO namespace `/live`, handshake `auth.token` = access token, room `site:<siteId>`, event `visit.updated {visitId, status}` (koi personal data nahi, client dobara fetch karega).
- Produces: `GET /dashboard/live` → `{ inside: VisitSummary[], expected: VisitSummary[], pending: VisitSummary[], needsCall: VisitSummary[] }`. Roles guard, reception, security, admin. Sirf apni site.
- Produces: `ExpiryJob.run(now = new Date()): Promise<number>` har 5 min: `INVITED | APPROVED | PENDING_APPROVAL` jinka `valid_to < now` ho, `EXPIRE`.
- Produces: `VisitSummary` type `packages/shared` mein: `{id, code, status, visitorName, company, photoUrl, hostName, validFrom, validTo, checkedInAt}`

- [ ] **Step 1: Failing tests likhein**

```ts
it('socket without token is disconnected', ...);
it('client gets visit.updated for own site, not other site', ...);
it('payload has only visitId and status', ...);
it('dashboard splits visits into the 4 lists', ...);
it('expected uses IST day: 00:30 IST visit counted in that IST day', ...);
it('needsCall only pending with reception_call_requested_at', ...);
it('expiry moves old INVITED/APPROVED/PENDING, leaves CHECKED_IN', ...);
```

- [ ] **Step 2: Run karein:** `pnpm --filter api test:e2e live`. Expected: FAIL.
- [ ] **Step 3: Gateway, dashboard aur job likhein.**
- [ ] **Step 4: Run karein:** `pnpm --filter api test:e2e live`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat(api): live updates, desk dashboard and expiry job"`

### Task 12: Shared API client

**Files:**
- Create: `packages/shared/src/client.ts`
- Test: `packages/shared/src/client.test.ts`

**Interfaces:**
- Produces (web aur mobile dono yahi use karenge):

```ts
createApiClient(o: {
  baseUrl: string;
  tokens: { get(): Promise<Tokens|null>; set(t: Tokens|null): Promise<void> };
  onSessionExpired(): void;
  fetchImpl?: typeof fetch;
}): ApiClient
class ApiError extends Error { status: number; code: ErrorCode; body: any }
class NetworkError extends Error {}
```

- `ApiClient` mein is plan ke har route ke typed methods: `visits.create`, `visits.list`, `visits.approve`, `gate.scan`, `gate.walkIn`, `publicInvites.get`, `publicInvites.register`, `dashboard.live`, wagairah. Timeout 15s.

- [ ] **Step 1: Failing tests likhein** (fake `fetchImpl` ke saath)

```ts
it('adds bearer token', ...);
it('401 refreshes once and retries', ...);
it('5 parallel 401s trigger one refresh', ...);
it('refresh failure clears tokens, calls onSessionExpired', ...);
it('error body becomes ApiError with code', ...);
it('fetch rejection becomes NetworkError', ...);
it('timeout becomes NetworkError', ...);
```

- [ ] **Step 2: Run karein:** `pnpm --filter @visitor/shared test client`. Expected: FAIL.
- [ ] **Step 3: Client likhein.** Koi Node-only API nahi, React Native mein bhi chalna chahiye.
- [ ] **Step 4: Run karein:** `pnpm --filter @visitor/shared test client`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat(shared): typed API client with token refresh"`

### Task 13: Deploy aur monitoring

**Files:**
- Create: `apps/api/Dockerfile`, `render.yaml`, `README.md`, `docs/runbook.md`
- Modify: `apps/api/src/main.ts` (Sentry, helmet, CORS, global throttle)
- Create: `apps/api/test/smoke.e2e.ts`

**Interfaces:**
- Produces: `CORS_ORIGINS` env, comma se alag exact domains (production mein web ka custom domain). `*` ya `*.vercel.app` allowed nahi, kyunki koi bhi Vercel par site bana sakta hai. Same list Socket.IO par bhi lagu. `PUBLIC_WEB_URL` web ka custom domain. Sentry `SENTRY_DSN` optional.
- Produces: `GET /health/details` (admin): `{ outboxPending, outboxFailed, oldestPendingSec, queueDepth }`, uptime aur alert isi se.

- [ ] **Step 1: Failing smoke test likhein:** poora flow API se: invite → register → scan IN → host ko event → scan OUT → `visit_events` mein types `CREATED, REGISTER, CHECK_IN, CHECK_OUT` is order mein. Aur: `/health/details` non-admin par 403.
- [ ] **Step 2: Run karein:** `pnpm --filter api test:e2e smoke`. Expected: `/health/details` wala FAIL.
- [ ] **Step 3: Health details, Sentry aur hardening likhein. Dockerfile aur `render.yaml` banayein.** Blueprint mein: web service `api` (Docker, `region: singapore`, plan Global Constraints ke hisaab se, `healthCheckPath: /health`, start command pehle `prisma migrate deploy` chalaye, kyunki ek hi instance hai aur free plan par pre-deploy pakka available nahi), Key Value `redis` (`region: singapore`, `maxmemoryPolicy: noeviction`, kyunki BullMQ ki jobs delete nahi honi chahiye). Database `visitor-db` (`region: singapore`), aur `DATABASE_URL` uski internal connection string se (`fromDatabase`). Saare secrets `sync: false`. Production par roz raat ek Render cron job `pg_dump` ko `BACKUP_S3_*` wale bucket mein save kare, taaki zaroorat par shift kar sakein. Staging par yeh job nahi chahiye. `runbook.md` mein: backup, restore test, key rotation, device revoke.
- [ ] **Step 4: Verify karein:** `pnpm --filter api test:e2e` poora PASS, aur Render staging par `curl https://<api-host>/health` par `{"status":"ok",...}`. Staging par: photo bucket ka public URL na khule, Jio aur Airtel dono par poora flow chale, aur India se gate scan p95 2 second ke andar ho. Deploy ke dauran live list polling se chalti rahe.
- [ ] **Step 5: Commit:** `git commit -am "chore: production image, monitoring and smoke test"`
