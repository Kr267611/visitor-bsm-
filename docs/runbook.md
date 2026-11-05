# Visitor system: runbook

## Launch checklist (asli visitors se pehle)

Staging free plans par chalta hai. Asli visitors ka data free plan par nahi rakhna hai.

- [ ] Render: `visitor-api` ko `0.5c-512mb` (Starter) par, Key Value ko 256 MB paid par, aur Postgres ko paid plan par karein. Free Postgres 30 din baad expire ho jata hai aur uska backup nahi hota.
- [ ] Photos ke liye S3-compatible bucket banayein, private rakhein, aur `S3_*` settings daalein.
- [ ] Backup: roz raat `pg_dump` kisi doosri jagah save ho, yeh job abhi bani nahi hai. Render ke paid Postgres ke backup options bhi dekh lein.
- [ ] Company se confirm karein ki visitors ka data Singapore mein rakhna theek hai.
- [ ] Consent aur privacy ka text legal se confirm karwayein, phir `CONSENT_VERSION` badlein.
- [ ] SMS: gateway account, DLT templates (`apps/api/src/notifications/templates.ts` aur `otp.service.ts` ka text), phir `SMS_PROVIDER=msg91`, `MSG91_AUTH_KEY`, `SMS_SENDER`.
- [ ] Staging par asli SMS, asli Expo push, aur India se gate scan ka speed test (p95 2 second ke andar). Jio aur Airtel dono par.
- [ ] `QR_*` keys production ke liye nayi banayein: `npx tsx scripts/gen-qr-keys.ts`.
- [ ] Android push: Firebase project (FCM) aur `eas init` ka projectId lagayein. Iske bina host ko sirf SMS jayega.
- [ ] Seed production par mat chalayein. Pehla admin SQL se banayein.

## Rozana monitoring

`GET /health` public hai, uptime check isi par lagayein. `GET /health/details` (admin login):

| Field | Kab dhyan dein |
|---|---|
| `outboxFailed` | 0 se upar: messages 5 baar fail ho chuke hain, gateway dekhein |
| `oldestPendingSec` | 300 se upar: worker atka hai ya gateway down hai |
| `queueDepth` | Lagatar badh raha ho: worker nahi chal raha |

Errors Sentry mein aayenge agar `SENTRY_DSN` set hai.

## Backup se restore

1. Naya database banayein, purana overwrite na karein.
2. `pg_restore --no-owner -d <naya-url> backup.dump`
3. Check karein: `SELECT count(*) FROM visits;`, aur `visit_events` ka trigger maujood hai.
4. `DATABASE_URL` naye database par karein aur redeploy karein.

Har 3 mahine mein ek baar restore test karein.

## QR key badalna

Nayi key lagate hi purane saare pass band ho jayenge. Rat ko karein, jab koi visit active na ho.

1. `npx tsx scripts/gen-qr-keys.ts`
2. Render mein `QR_PRIVATE_KEY` aur `QR_PUBLIC_KEY` badlein, redeploy karein.
3. Aaj aur aage ke visitors ko host "resend invite" se naya link bheje.

## Guard ka phone kho gaya

Admin web app, ya `POST /admin/devices/:id/revoke`. Access turant band ho jata hai.

## Internet ya server band hai

Phase 1 mein offline mode nahi hai. Guard paper register par naam, number, host aur time likhe, aur baad mein entry system mein daal de.
