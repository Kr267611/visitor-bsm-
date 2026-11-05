import { execSync } from 'node:child_process';

export default async function globalSetup() {
  execSync('npx prisma migrate deploy', {
    cwd: `${__dirname}/..`,
    env: {
      ...process.env,
      DATABASE_URL: 'postgresql://visitor:visitor@localhost:5433/visitor_test',
    },
    stdio: 'pipe',
  });
}
