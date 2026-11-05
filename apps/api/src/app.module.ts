import { Module } from '@nestjs/common';
import { AdminController, ProfileController } from './admin/admin.controller';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.service';
import { RedisModule } from './redis/redis.service';

@Module({
  imports: [PrismaModule, RedisModule, NotificationsModule, AuthModule],
  controllers: [HealthController, AdminController, ProfileController],
})
export class AppModule {}
