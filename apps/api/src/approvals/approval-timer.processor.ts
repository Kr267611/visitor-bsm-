import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { runInTenant } from '../tenancy/request-context';
import { VisitLifecycleService } from '../visits/visit-lifecycle.service';

export type TimerName = 'reminder' | 'delegate' | 'reception';

const TIMERS: { name: TimerName; env: string; fallbackSec: number }[] = [
  { name: 'reminder', env: 'APPROVAL_REMINDER_SEC', fallbackSec: 90 },
  { name: 'delegate', env: 'APPROVAL_DELEGATE_SEC', fallbackSec: 180 },
  { name: 'reception', env: 'APPROVAL_RECEPTION_SEC', fallbackSec: 300 },
];

/** BullMQ job ids may not contain `:`. */
const jobId = (visitId: string, name: TimerName) => `${visitId}_${name}`;

/** If the host does not respond: a reminder, then the backup person, then a call task for reception. */
@Injectable()
export class ApprovalTimerProcessor implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly lifecycle: VisitLifecycleService,
  ) {}

  onModuleInit() {
    for (const { name } of TIMERS) {
      this.jobs.register(`approval.${name}`, (data: { visitId: string }) => this.process({ name, data }));
    }
  }

  async schedule(visitId: string): Promise<void> {
    for (const { name, env, fallbackSec } of TIMERS) {
      const seconds = Number(process.env[env] ?? fallbackSec);
      await this.jobs.delay(`approval.${name}`, { visitId }, seconds * 1000, jobId(visitId, name));
    }
  }

  async cancel(visitId: string): Promise<void> {
    await Promise.all(TIMERS.map(({ name }) => this.jobs.remove(jobId(visitId, name))));
  }

  async process(job: { name: TimerName; data: { visitId: string } }): Promise<void> {
    const visit = await this.prisma.visit.findUnique({
      where: { id: job.data.visitId },
      include: { visitor: true, host: true },
    });
    // Already decided: nothing to do.
    if (visit?.status !== 'PENDING_APPROVAL') return;
    await runInTenant(visit.businessId, () => this.escalate(job.name, visit));
  }

  private async escalate(
    name: TimerName,
    visit: Prisma.VisitGetPayload<{ include: { visitor: true; host: true } }>,
  ): Promise<void> {

    if (name === 'reminder') {
      await this.lifecycle.recordEvent(visit.id, 'REMINDER_SENT', null, { to: visit.hostId }, [
        {
          channel: 'PUSH',
          template: 'APPROVAL_REMINDER',
          recipient: visit.hostId,
          vars: { visitorName: visit.visitor.name },
        },
      ]);
    } else if (name === 'delegate') {
      if (!visit.host.delegateId) return;
      await this.lifecycle.recordEvent(visit.id, 'ESCALATED_TO_DELEGATE', null, { to: visit.host.delegateId }, [
        {
          channel: 'PUSH',
          template: 'APPROVAL_REQUEST',
          recipient: visit.host.delegateId,
          vars: { visitorName: visit.visitor.name, company: visit.visitor.company ?? '-', purpose: visit.purpose },
        },
      ]);
    } else {
      await this.prisma.visit.update({
        where: { id: visit.id },
        data: { receptionCallRequestedAt: new Date() },
      });
      await this.lifecycle.recordEvent(visit.id, 'RECEPTION_CALL_REQUESTED', null);
      this.lifecycle.announce(visit);
    }
  }
}
