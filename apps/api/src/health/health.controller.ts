import { Controller, Get, HttpException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check() {
    const [db, redis] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => 'up', () => 'down'),
      this.redis.client.ping().then(() => 'up', () => 'down'),
    ]);
    const body = { status: db === 'up' && redis === 'up' ? 'ok' : 'degraded', db, redis };
    if (body.status !== 'ok') throw new HttpException(body, 503);
    return body;
  }
}
