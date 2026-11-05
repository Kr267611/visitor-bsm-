import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AdminController, ProfileController } from './admin/admin.controller';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { JobsModule } from './jobs/jobs.service';
import { NotificationsModule } from './notifications/notifications.module';
import { PassesModule } from './passes/passes.module';
import { PrismaModule } from './prisma/prisma.service';
import { RedisModule } from './redis/redis.service';
import { VisitsModule } from './visits/visits.module';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    PrismaModule,
    RedisModule,
    JobsModule,
    NotificationsModule,
    AuthModule,
    PassesModule,
    VisitsModule,
  ],
  controllers: [HealthController, AdminController, ProfileController],
})
export class AppModule {}
