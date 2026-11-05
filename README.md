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

`pnpm services` Docker ke bina PostgreSQL (5433) aur Redis (6380) chalata hai, Windows par. Mac ya Linux par, ya Docker ho to, iski jagah `docker compose up -d` chalayein. Ise chalta chhod kar doosre terminal mein:

```bash
cp .env.example apps/api/.env
cd apps/api
npx tsx scripts/gen-qr-keys.ts >> .env
```

Ab `apps/api/.env` mein `JWT_SECRET=change-me` ko koi lamba random text karein, warna server start nahi hoga. Phir:

```bash
npx prisma migrate deploy
npx tsx prisma/seed.ts
pnpm dev
```

Web app ke liye doosre terminal mein `pnpm --filter web dev`, phir http://localhost:5173 kholein.

Seed ke test accounts ke numbers `apps/api/prisma/seed.ts` mein hain. `SMS_PROVIDER=console` par OTP terminal mein dikhta hai.

## Tests

```bash
pnpm --filter @visitor/shared test
pnpm --filter api test
pnpm --filter api test:e2e
```

## Deploy

Backend Render par: `render.yaml` Blueprint se. Web app Vercel par. Asli launch se pehle [runbook](docs/runbook.md) ki Launch checklist poori karein.
