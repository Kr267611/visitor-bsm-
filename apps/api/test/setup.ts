import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { FakeSmsProvider } from '../src/notifications/fake-sms.provider';
import { FakePushProvider, PUSH_PROVIDER } from '../src/notifications/push.provider';
import { SMS_PROVIDER } from '../src/notifications/sms.provider';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { runInTenant } from '../src/tenancy/request-context';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  redis: RedisService;
  sms: FakeSmsProvider;
  push: FakePushProvider;
}

export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.listen(0);
  return {
    app,
    prisma: app.get(PrismaService),
    redis: app.get(RedisService),
    sms: app.get(SMS_PROVIDER),
    push: app.get(PUSH_PROVIDER),
  };
}

/** Access token for a test user without going through OTP. */
export async function tokenFor(ctx: TestContext, userId: string): Promise<string> {
  const device = await ctx.prisma.device.create({ data: { userId, name: 'test device' } });
  return ctx.app.get(JwtService).signAsync({ sub: userId, deviceId: device.id });
}

/** Clears all data before each test. TRUNCATE does not fire the append-only trigger. */
export async function resetData(ctx: TestContext): Promise<void> {
  await ctx.prisma.$executeRawUnsafe(
    'TRUNCATE audit_logs, visit_events, outbox, refresh_tokens, devices, visits, visitors, user_premises, users, departments, gates, premises_settings, premises, businesses CASCADE',
  );
  await ctx.redis.client.flushdb();
  ctx.sms.sent.length = 0;
  ctx.sms.failing = false;
  ctx.push.sent.length = 0;
  ctx.push.failing = false;
}

/**
 * Runs a service inside the test business (like an HTTP request). The scoped client throws without
 * a business, so tests that call services directly wrap them with this.
 */
export function inTenant<T extends object>(ctx: TestContext, service: T, slug = 'test-biz'): T {
  return new Proxy(service, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        const { id } = await ctx.prisma.business.findUniqueOrThrow({ where: { slug } });
        return runInTenant(id, () => value.apply(target, args));
      };
    },
  });
}
