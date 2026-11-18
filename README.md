# Visitor BSM

Multi-business visitor management system: NestJS API, React web app and Expo mobile app.

- Architecture: [docs/superpowers/specs/2026-11-18-vms-architecture-design.md](docs/superpowers/specs/2026-11-18-vms-architecture-design.md)
- Deployment plan: [docs/deployment-plan.md](docs/deployment-plan.md)
- Operations: [docs/runbook.md](docs/runbook.md)
- Acceptance checklist: [docs/phase1-acceptance.md](docs/phase1-acceptance.md)

## Local setup

Requires Node 22+ and pnpm 10.

```bash
pnpm install
bash scripts/setup-redis.sh
pnpm services
```

`pnpm services` runs PostgreSQL (port 5433) and Redis (port 6380) on Windows without Docker. On macOS or Linux, or if you have Docker, run `docker compose up -d` instead. Leave it running and open a second terminal:

```bash
cp .env.example apps/api/.env
cd apps/api
npx tsx scripts/gen-qr-keys.ts >> .env
```

In `apps/api/.env`, replace `JWT_SECRET=change-me` with a long random value; the server refuses to start otherwise. Then:

```bash
npx prisma migrate deploy
npx tsx --env-file=.env prisma/seed.ts
pnpm dev
```

For the web app, run `pnpm --filter web dev` in another terminal and open http://localhost:5173.

The seed creates the business "BSM" with one premises and test accounts (numbers are in `apps/api/prisma/seed.ts`). With `SMS_PROVIDER=console`, OTPs are printed in the API terminal. Users can then set a password under **Password** in the side menu.

## Tests

```bash
pnpm --filter @visitor/shared test
pnpm --filter api test
pnpm --filter api test:e2e
pnpm --filter web test
pnpm --filter mobile test
```

## Deploy

See [docs/deployment-plan.md](docs/deployment-plan.md). In short: the API, PostgreSQL and Redis run on Render (`render.yaml` Blueprint), the web app runs on Render or Vercel, and the mobile app is built with Expo EAS. Complete the launch checklist in the [runbook](docs/runbook.md) before real visitors use the system.
