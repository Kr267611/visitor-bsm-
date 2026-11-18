import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DepartmentsController } from './admin/departments.controller';
import { PremisesController } from './admin/premises.controller';
import { ProfileController } from './admin/profile.controller';
import { UsersController } from './admin/users.controller';
import { AuthModule } from './auth/auth.module';
import { GateModule } from './gate/gate.module';
import { HealthController } from './health/health.controller';
import { JobsModule } from './jobs/jobs.service';
import { LiveModule } from './live/live.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PassesModule } from './passes/passes.module';
import { PlatformController } from './platform/platform.controller';
import { PlansModule } from './plans/plan-limits.service';
import { PrismaModule } from './prisma/prisma.service';
import { SelfCheckInModule } from './self-checkin/self-checkin.controller';
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
    SelfCheckInModule,
  ],
  controllers: [
    HealthController,
    PremisesController,
    DepartmentsController,
    UsersController,
    ProfileController,
    PlatformController,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
