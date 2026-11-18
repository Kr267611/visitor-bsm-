# Deployment plan

This plan covers what runs where, in what order to deploy it, and what to check before real visitors use the system. Prices are approximate and must be confirmed on each provider's pricing page before purchase.

## 1. What runs where

| Part | Technology | Where | Staging | Production |
|---|---|---|---|---|
| API + background jobs | NestJS in Docker (`apps/api/Dockerfile`) | Render Web Service, Singapore | Free | Starter (0.5 CPU, 512 MB) or higher |
| Database | PostgreSQL 16+ | Render Postgres, Singapore | Free (expires after 30 days, no backups) | Paid plan with daily backups |
| Queue and cache | Redis (BullMQ), `noeviction` | Render Key Value, Singapore | Free | Paid 256 MB |
| Web app (admin, desk, host, visitor pages) | React static build (`apps/web`) | Render Static Site (in `render.yaml`) | Free | Free, or Vercel Pro |
| Visitor photos | S3-compatible bucket, private | Cloudflare R2, or AWS S3 Mumbai (`ap-south-1`) | Memory (lost on restart) | Private bucket |
| Mobile app (guard and host) | Expo / React Native (`apps/mobile`) | Expo EAS Build | Android APK, shared directly | Google Play (AAB); iOS later |
| SMS (OTP, invite links, passes) | MSG91 | MSG91 with DLT-registered templates | Console (printed in API logs) | MSG91 |
| Push notifications | Expo Push → FCM | Expo + Firebase project | Optional | Required for Android |
| Error tracking | Sentry | sentry.io | Optional | Recommended (free tier) |
| Domain and HTTPS | Custom domain | DNS provider → Render | `*.onrender.com` | `api.<company-domain>`, `visitors.<company-domain>` |

Notes:

- **Vercel:** the free Hobby plan is for non-commercial use only. For company use, either keep the web app on Render's static site (already in `render.yaml`) or use Vercel Pro.
- **Free Render web services sleep** after about 15 minutes without traffic. The first gate scan after that waits roughly a minute, and background jobs (SMS retries, expiry, approval reminders) stop while asleep. Production must use a paid instance.
- **Data location:** Render's nearest region is Singapore. If the company requires visitor data to stay in India, the database, API and bucket must move to an Indian region (for example AWS Mumbai). Confirm this before launch.

## 2. Environments

| Environment | Branch | Purpose | Data |
|---|---|---|---|
| Local | any | Development | Seeded test data |
| Staging | `main` | Testing with real phones before release | Test data only |
| Production | `main` (manual deploy) or a `production` branch | Real use | Real visitors |

The `foundation` branch (multi-business, sign-in v2, new admin pages) must be merged into `main` only after F9 (mobile sign-in) is finished and all test suites pass.

## 3. Environment variables

Set these in the Render dashboard. Never commit their values to the repository.

**API (`visitor-api`)**

| Variable | Value |
|---|---|
| `DATABASE_URL`, `REDIS_URL` | Filled automatically by the Blueprint |
| `JWT_SECRET` | Generated automatically by the Blueprint |
| `QR_PRIVATE_KEY`, `QR_PUBLIC_KEY` | From `npx tsx scripts/gen-qr-keys.ts` (a new pair for each environment) |
| `PUBLIC_WEB_URL` | URL of the web app, e.g. `https://visitors.<company-domain>` |
| `CORS_ORIGINS` | The same web app URL (full domain, no wildcards) |
| `CONSENT_VERSION` | `v1`, changed whenever the privacy text changes |
| `SMS_PROVIDER` | `console` on staging, `msg91` in production |
| `MSG91_AUTH_KEY`, `SMS_SENDER` | From MSG91 (production) |
| `STORAGE_DRIVER` | Remove in production so the S3 settings are used |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | From the bucket provider |
| `SENTRY_DSN` | From Sentry (optional on staging) |

**Web app (`visitor-web`)**

| Variable | Value |
|---|---|
| `VITE_API_URL` | URL of the API, e.g. `https://api.<company-domain>`. The build fails without it on purpose. |

**Mobile app (`apps/mobile/eas.json`)**

| Profile | `EXPO_PUBLIC_API_URL` |
|---|---|
| `preview` | Staging API URL |
| `production` | Production API URL |

## 4. Deployment steps

### Step 1: Prepare the code

1. Finish F9 (mobile sign-in and premises) on the `foundation` branch.
2. Run every test suite: shared, API unit, API e2e, web, mobile.
3. Open a pull request from `foundation` to `main`, review it, and merge.
4. Make the GitHub repository **private** before any real data or company details are involved.

### Step 2: Staging

1. Take a backup of the staging database if it holds anything worth keeping. The `multi_tenant` migration moves all existing data into one business called "BSM"; it is tested, but it cannot be undone automatically.
2. In Render, open the Blueprint and click **Sync** (or create it from `render.yaml` the first time). This creates or updates the API, web app, database and Redis.
3. Fill in the variables from section 3. The API runs database migrations on start.
4. Create the first super admin. There is no sign-up screen for this on purpose; insert one row with Render's database shell:

   ```sql
   INSERT INTO users (id, name, phone, role, is_active, is_host)
   VALUES (gen_random_uuid(), 'Platform Admin', '+91XXXXXXXXXX', 'super_admin', true, false);
   ```

5. Sign in as the super admin (OTP) and create the company with `POST /platform/businesses` (plan, first premises, first admin). Until the platform panel exists, use the API directly (for example with Postman).
6. Build the Android test app: `cd apps/mobile && npx eas build --profile preview --platform android`, and share the APK with testers.
7. Walk through `docs/phase1-acceptance.md` on real phones.

### Step 3: Production

1. Upgrade the plans (section 1): API Starter, Postgres paid with backups, Key Value paid.
2. Create the private photo bucket and set the `S3_*` variables; remove `STORAGE_DRIVER=memory`.
3. Register every SMS text with DLT exactly as written in `apps/api/src/notifications/templates.ts` and `apps/api/src/auth/otp.service.ts`. The texts are now in English, so any templates registered earlier in Hindi must be registered again.
4. Generate new QR keys for production.
5. Connect the custom domains in Render (`api.` for the API, `visitors.` for the web app), then update `PUBLIC_WEB_URL`, `CORS_ORIGINS`, `VITE_API_URL` and the mobile `production` profile.
6. Set up Firebase (FCM) and `eas init` for Android push.
7. Build the production Android app: `npx eas build --profile production --platform android`, and publish it on Google Play (internal testing track first).
8. Complete the launch checklist in `docs/runbook.md`, including legal approval of the privacy text.

## 5. Checks after every deploy

- `GET https://<api>/health` returns 200.
- Sign in on the web with password and with OTP.
- Create an invite, open the SMS link, register, and scan the pass at a gate.
- Walk-in: OTP, photo, host approval on the host's phone.
- The desk updates live without refreshing.
- `GET /health/details` (as admin): `outboxFailed` is 0 and `oldestPendingSec` is low.

## 6. Rollback

- **Code:** Render keeps previous deploys; use **Rollback** on the service. The web app and API roll back independently.
- **Database:** migrations only move forward. Take a backup before every deploy that contains a migration, and restore it as described in `docs/runbook.md` if needed.
- **Mobile:** keep the previous APK/AAB; Google Play allows halting a staged rollout.

## 7. Monthly cost estimate (production, approximate)

| Item | Approximate cost |
|---|---|
| Render API (Starter) | about $7 |
| Render Postgres (small paid plan with backups) | about $6–20 |
| Render Key Value (256 MB) | about $10 |
| Web app on Render static site | free |
| Cloudflare R2 (first 10 GB) | free |
| MSG91 SMS | pay per message (DLT registration required) |
| Sentry (developer tier) | free |
| Google Play developer account | one-time about $25 |
| Apple developer account (only for iOS) | about $99 per year |

Total to start: roughly **$25–40 per month** plus SMS charges. Confirm current prices before purchase.
