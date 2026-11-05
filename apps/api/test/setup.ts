import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { FakeSmsProvider } from '../src/notifications/fake-sms.provider';
import { SMS_PROVIDER } from '../src/notifications/sms.provider';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  redis: RedisService;
  sms: FakeSmsProvider;
}

export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return {
    app,
    prisma: app.get(PrismaService),
    redis: app.get(RedisService),
    sms: app.get(SMS_PROVIDER),
  };
}

/** OTP ke bina test user ka access token. */
export async function tokenFor(ctx: TestContext, userId: string): Promise<string> {
  const device = await ctx.prisma.device.create({ data: { userId, name: 'test device' } });
  return ctx.app.get(JwtService).signAsync({ sub: userId, deviceId: device.id });
}

/** Har test se pehle saara data saaf. TRUNCATE par append-only trigger nahi chalta. */
export async function resetData(ctx: TestContext): Promise<void> {
  await ctx.prisma.$executeRawUnsafe(
    'TRUNCATE visit_events, outbox, refresh_tokens, devices, visits, visitors, users, gates, sites CASCADE',
  );
  await ctx.redis.client.flushdb();
  ctx.sms.sent.length = 0;
  ctx.sms.failing = false;
}
