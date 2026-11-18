import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const EVERY_MS = 24 * 60 * 60 * 1000;

/** Privacy promise: photos and ID details are deleted after 180 days. The visit record stays. */
@Injectable()
export class RetentionJob implements OnModuleInit {
  private readonly logger = new Logger('Retention');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.jobs.register('retention.run', () => this.run());
    this.jobs.repeat('retention.run', EVERY_MS);
  }

  async run(now: Date = new Date()): Promise<number> {
    const rows = await this.prisma.visitor.findMany({ where: { deleteAfter: { lt: now } } });
    let done = 0;
    for (const row of rows) {
      try {
        if (row.photoKey) await this.storage.delete(row.photoKey);
        await this.prisma.visitor.update({
          where: { id: row.id },
          data: { photoKey: null, idType: null, idLast4: null, deleteAfter: null },
        });
        done += 1;
      } catch (error) {
        // It will be retried tomorrow night.
        this.logger.error(`Visitor ${row.id}: ${(error as Error).message}`);
      }
    }
    return done;
  }
}
