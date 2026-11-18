import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Outbox } from '@prisma/client';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { PUSH_PROVIDER, PushProvider } from './push.provider';
import { SMS_PROVIDER, SmsProvider } from './sms.provider';
import { renderTemplate, TemplateKey } from './templates';

const BATCH_SIZE = 50;
const LEASE_MS = 120_000;
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 30 * 60_000;
// Keeps retrying for about 3.5 hours so a long gateway outage does not lose the message.
const MAX_ATTEMPTS = 12;
const TICK_MS = 5_000;
const APPROVAL_TEMPLATES: string[] = ['APPROVAL_REQUEST', 'APPROVAL_REMINDER'];

@Injectable()
export class OutboxWorker implements OnModuleInit {
  private readonly logger = new Logger('Outbox');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
  ) {}

  onModuleInit() {
    this.jobs.register('outbox.tick', () => this.tick());
    this.jobs.repeat('outbox.tick', TICK_MS);
  }

  /** Sends pending messages. Returns how many were picked up. */
  async tick(now: Date = new Date()): Promise<number> {
    const rows = await this.claim(now);
    for (const row of rows) {
      try {
        const providerMsgId = await this.deliver(row);
        await this.prisma.outbox.update({
          where: { id: row.id },
          data: { status: 'SENT', providerMsgId, lastError: null },
        });
      } catch (error) {
        await this.recordFailure(row, now, error as Error);
      }
    }
    return rows.length;
  }

  /** Leases rows briefly so another tick does not send the same message. */
  private async claim(now: Date): Promise<Outbox[]> {
    const iso = now.toISOString();
    const lease = new Date(now.getTime() + LEASE_MS).toISOString();
    const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE outbox
      SET next_retry_at = (${lease}::timestamptz AT TIME ZONE 'UTC')
      WHERE id IN (
        SELECT id FROM outbox
        WHERE status = 'PENDING' AND next_retry_at <= (${iso}::timestamptz AT TIME ZONE 'UTC')
        ORDER BY created_at
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;
    if (!claimed.length) return [];
    return this.prisma.outbox.findMany({ where: { id: { in: claimed.map((r) => r.id) } } });
  }

  private async deliver(row: Outbox): Promise<string | null> {
    const text = renderTemplate(row.template as TemplateKey, row.vars as Record<string, string>);
    if (row.channel === 'SMS') return (await this.sms.send(row.recipient, text)).id;

    const devices = await this.prisma.device.findMany({
      where: { userId: row.recipient, revokedAt: null, pushToken: { not: null } },
    });
    const results = await Promise.allSettled(
      devices.map((d) =>
        this.push.send({
          token: d.pushToken as string,
          body: text,
          data: { visitId: row.visitId ?? '', template: row.template },
        }),
      ),
    );
    if (results.some((r) => r.status === 'fulfilled')) return null;
    return this.fallbackToSms(row, text);
  }

  /** Push did not arrive: send the same text by SMS. Approvals include a web link so the host can respond without the app. */
  private async fallbackToSms(row: Outbox, text: string): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: row.recipient } });
    const link =
      APPROVAL_TEMPLATES.includes(row.template) && row.visitId
        ? ` ${process.env.PUBLIC_WEB_URL}/my/visits/${row.visitId}`
        : '';
    return (await this.sms.send(user.phone, `${text}${link}`)).id;
  }

  private async recordFailure(row: Outbox, now: Date, error: Error) {
    const attempts = row.attempts + 1;
    const failed = attempts >= MAX_ATTEMPTS;
    if (failed) this.logger.error(`Message ${row.id} (${row.template}) band: ${error.message}`);
    await this.prisma.outbox.update({
      where: { id: row.id },
      data: {
        attempts,
        status: failed ? 'FAILED' : 'PENDING',
        lastError: error.message,
        nextRetryAt: new Date(now.getTime() + Math.min(BASE_BACKOFF_MS * 2 ** row.attempts, MAX_BACKOFF_MS)),
      },
    });
  }
}
