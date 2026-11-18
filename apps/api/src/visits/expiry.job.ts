import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { runInTenant } from '../tenancy/request-context';
import { InvalidTransitionError } from './errors';
import { VisitLifecycleService } from './visit-lifecycle.service';

const EVERY_MS = 5 * 60 * 1000;

/** Once `valid_to` has passed the visit becomes EXPIRED. Visitors still inside are left alone. */
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
      select: { id: true, businessId: true },
    });
    let expired = 0;
    // The job reads across businesses (raw client); each change runs inside that visit's business.
    for (const { id, businessId } of rows) {
      try {
        await runInTenant(businessId, () => this.lifecycle.apply({ visitId: id, action: 'EXPIRE', actorId: null }));
        expired += 1;
      } catch (error) {
        // Someone checked in meanwhile: that is fine.
        if (!(error instanceof InvalidTransitionError)) throw error;
      }
    }
    return expired;
  }
}
