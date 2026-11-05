import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.service';
import { RedisModule } from './redis/redis.service';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [HealthController],
})
export class AppModule {}
