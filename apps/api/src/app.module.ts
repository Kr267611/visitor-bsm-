import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminController, ProfileController } from './admin/admin.controller';
import { AuthModule } from './auth/auth.module';
import { GateModule } from './gate/gate.module';
import { HealthController } from './health/health.controller';
import { JobsModule } from './jobs/jobs.service';
import { LiveModule } from './live/live.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PassesModule } from './passes/passes.module';
import { PlansModule } from './plans/plan-limits.service';
import { PrismaModule } from './prisma/prisma.service';
import { RedisModule } from './redis/redis.service';
import { TenancyModule } from './tenancy/tenancy.module';
import { StorageModule } from './storage/storage.service';
import { VisitsModule } from './visits/visits.module';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }]),
    PrismaModule,
    TenancyModule,
    PlansModule,
    RedisModule,
    JobsModule,
    NotificationsModule,
    AuthModule,
    PassesModule,
    StorageModule,
    VisitsModule,
    GateModule,
    LiveModule,
  ],
  controllers: [HealthController, AdminController, ProfileController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
