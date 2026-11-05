import { Controller, Get, HttpException } from '@nestjs/common';
import { Public, Roles } from '../auth/roles.decorator';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jobs: JobsService,
  ) {}

  @Public()
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

  /** Monitoring ke liye: SMS atak to nahi rahe, background jobs chal rahe hain ya nahi. */
  @Roles('admin')
  @Get('details')
  async details() {
    const [outboxPending, outboxFailed, oldest, queueDepth] = await Promise.all([
      this.prisma.outbox.count({ where: { status: 'PENDING' } }),
      this.prisma.outbox.count({ where: { status: 'FAILED' } }),
      this.prisma.outbox.findFirst({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' } }),
      this.jobs.queue.count(),
    ]);
    return {
      outboxPending,
      outboxFailed,
      oldestPendingSec: oldest ? Math.floor((Date.now() - oldest.createdAt.getTime()) / 1000) : 0,
      queueDepth,
    };
  }
}
