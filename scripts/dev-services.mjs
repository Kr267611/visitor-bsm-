// Docker ke bina local PostgreSQL (5433) aur Redis (6380) chalata hai. Data `.tools/` mein rehta hai.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const tools = resolve('.tools');
const pgDir = resolve(tools, 'pgdata');
const redisExe = resolve(tools, 'redis', 'redis-server.exe');

if (!existsSync(redisExe)) {
  console.error('Redis nahi mila. Pehle chalayein: bash scripts/setup-redis.sh');
  process.exit(1);
}

mkdirSync(tools, { recursive: true });
const firstRun = !existsSync(resolve(pgDir, 'PG_VERSION'));

const pg = new EmbeddedPostgres({
  databaseDir: pgDir,
  user: 'visitor',
  password: 'visitor',
  port: 5433,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

if (firstRun) await pg.initialise();
await pg.start();
if (firstRun) {
  await pg.createDatabase('visitor_dev');
  await pg.createDatabase('visitor_test');
}
console.log('PostgreSQL chalu: 5433');

const redis = spawn(redisExe, ['--port', '6380', '--save', '', '--appendonly', 'no'], {
  stdio: 'inherit',
});

async function stop() {
  redis.kill();
  await pg.stop();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
