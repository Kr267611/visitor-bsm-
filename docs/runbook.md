# Visitor system: runbook

## Launch checklist (before real visitors)

Staging runs on free plans. Real visitor data must never be stored on a free plan.

- [ ] Render: move `visitor-api` to Starter (0.5 CPU, 512 MB), Key Value to the paid 256 MB plan, and Postgres to a paid plan. Free Postgres expires after 30 days and has no backups.
- [ ] Create a private S3-compatible bucket for photos and set the `S3_*` settings.
- [ ] Backups: a nightly `pg_dump` saved somewhere else (this job does not exist yet). Also review the backup options of Render's paid Postgres.
- [ ] Confirm with the company that storing visitor data in Singapore is acceptable.
- [ ] Have legal approve the consent and privacy text, then change `CONSENT_VERSION`.
- [ ] SMS: gateway account and DLT templates (the exact texts in `apps/api/src/notifications/templates.ts` and `otp.service.ts`), then set `SMS_PROVIDER=msg91`, `MSG91_AUTH_KEY` and `SMS_SENDER`.
- [ ] On staging: real SMS, real Expo push, and a gate-scan speed test from India (p95 under 2 seconds) on both Jio and Airtel.
- [ ] Generate new `QR_*` keys for production: `npx tsx scripts/gen-qr-keys.ts`.
- [ ] Android push: a Firebase project (FCM) and the `eas init` projectId. Without them hosts receive SMS only.
- [ ] Never run the seed in production. Create the first business and its admin through the platform API (`POST /platform/businesses`) as a super admin.

## Daily monitoring

`GET /health` is public; point the uptime check at it. `GET /health/details` (admin sign-in):

| Field | When to act |
|---|---|
| `outboxFailed` | Above 0: messages failed repeatedly; check the gateway |
| `oldestPendingSec` | Above 300: the worker is stuck or the gateway is down |
| `queueDepth` | Keeps growing: the worker is not running |

Errors go to Sentry when `SENTRY_DSN` is set.

## Restore from backup

1. Create a new database; never overwrite the old one.
2. `pg_restore --no-owner -d <new-url> backup.dump`
3. Check `SELECT count(*) FROM visits;` and that the `visit_events` and `audit_logs` triggers exist.
4. Point `DATABASE_URL` at the new database and redeploy.

Test a restore once every 3 months.

## Rotating the QR key

All existing passes stop working as soon as the new key is live. Do it at night when no visit is active.

1. `npx tsx scripts/gen-qr-keys.ts`
2. Update `QR_PRIVATE_KEY` and `QR_PUBLIC_KEY` on Render and redeploy.
3. Hosts send today's and future visitors a new link with "Resend link".

## A guard's phone is lost

Block it in the web app under **Admin → Devices**, or call `POST /admin/devices/:id/revoke`. Access stops immediately.

## Internet or server is down

There is no offline mode yet. The guard writes name, number, host and time in the paper register and enters it into the system later.
