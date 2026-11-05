import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvalidTransitionError } from './errors';
import { VisitLifecycleService } from './visit-lifecycle.service';

const EVERY_MS = 5 * 60 * 1000;

/** `valid_to` nikal chuka ho to visit EXPIRED. Andar baithe visitor ko nahi chhuta. */
@Injectable()
export class ExpiryJob implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: VisitLifecycleService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.jobs.register('expiry.run', () => this.run());
    this.jobs.repeat('expiry.run', EVERY_MS);
  }

  async run(now: Date = new Date()): Promise<number> {
    const rows = await this.prisma.visit.findMany({
      where: { status: { in: ['INVITED', 'APPROVED', 'PENDING_APPROVAL'] }, validTo: { lt: now } },
      select: { id: true },
    });
    let expired = 0;
    for (const { id } of rows) {
      try {
        await this.lifecycle.apply({ visitId: id, action: 'EXPIRE', actorId: null });
        expired += 1;
      } catch (error) {
        // Isi beech kisi ne check-in kar diya: theek hai.
        if (!(error instanceof InvalidTransitionError)) throw error;
      }
    }
    return expired;
  }
}
