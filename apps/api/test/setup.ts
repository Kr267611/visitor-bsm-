import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  redis: RedisService;
}

export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService), redis: app.get(RedisService) };
}

/** Har test se pehle saara data saaf. TRUNCATE par append-only trigger nahi chalta. */
export async function resetData(ctx: TestContext): Promise<void> {
  await ctx.prisma.$executeRawUnsafe(
    'TRUNCATE visit_events, outbox, refresh_tokens, devices, visits, visitors, users, gates, sites CASCADE',
  );
  await ctx.redis.client.flushdb();
}
