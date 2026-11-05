# Visitor BSM

Company ka visitor management system: API, web app aur mobile app.

- Design: [docs/design/visitor-bsm-design.html](docs/design/visitor-bsm-design.html)
- Plans: [docs/superpowers/plans](docs/superpowers/plans)
- Operations: [docs/runbook.md](docs/runbook.md)

## Local setup

Node 22+ aur pnpm 10 chahiye.

```bash
pnpm install
bash scripts/setup-redis.sh
pnpm services
```

`pnpm services` Docker ke bina PostgreSQL (5433) aur Redis (6380) chalata hai. Docker ho to `docker compose up -d` bhi chalega. Ise chalta chhod kar doosre terminal mein:

```bash
cp .env.example apps/api/.env
cd apps/api
npx tsx scripts/gen-qr-keys.ts >> .env
npx prisma migrate deploy
npx tsx prisma/seed.ts
pnpm dev
```

Seed ke test accounts ke numbers `apps/api/prisma/seed.ts` mein hain. `SMS_PROVIDER=console` par OTP terminal mein dikhta hai.

## Tests

```bash
pnpm --filter @visitor/shared test
pnpm --filter api test
pnpm --filter api test:e2e
```

## Deploy

Backend Render par: `render.yaml` Blueprint se. Web app Vercel par. Asli launch se pehle [runbook](docs/runbook.md) ki Launch checklist poori karein.
