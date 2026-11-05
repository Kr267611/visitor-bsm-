import { Global, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';

type Handler = (data: any) => Promise<unknown>;

const QUEUE_NAME = 'visitor-jobs';

/**
 * Background jobs ka ek hi darwaza. Worker sirf `startWorker()` par chalta hai (main.ts se),
 * isliye tests mein jobs apne aap nahi chalte.
 */
@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly logger = new Logger('Jobs');
  private readonly connection = {
    url: process.env.REDIS_URL ?? 'redis://localhost:6380',
    maxRetriesPerRequest: null,
  };
  readonly queue = new Queue(QUEUE_NAME, { connection: this.connection });
  private readonly handlers = new Map<string, Handler>();
  private readonly repeats = new Map<string, number>();
  private worker: Worker | null = null;

  register(name: string, handler: Handler): void {
    this.handlers.set(name, handler);
  }

  /** `startWorker` ke baad har `everyMs` par chalega. */
  repeat(name: string, everyMs: number): void {
    this.repeats.set(name, everyMs);
  }

  async delay(name: string, data: object, delayMs: number, jobId: string): Promise<void> {
    await this.queue.add(name, data, { delay: delayMs, jobId, removeOnComplete: true, removeOnFail: 100 });
  }

  async remove(jobId: string): Promise<void> {
    const job = await this.queue.getJob(jobId);
    if (job) await job.remove();
  }

  async startWorker(): Promise<void> {
    for (const [name, every] of this.repeats) {
      await this.queue.upsertJobScheduler(name, { every }, { name, opts: { removeOnComplete: true, removeOnFail: 100 } });
    }
    this.worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        const handler = this.handlers.get(job.name);
        if (!handler) throw new Error(`Job handler nahi mila: ${job.name}`);
        return handler(job.data);
      },
      { connection: this.connection, concurrency: 5 },
    );
    this.worker.on('failed', (job, err) => this.logger.error(`${job?.name} fail: ${err.message}`));
    this.worker.on('error', (err) => this.logger.error(err.message));
  }

  async stopWorker(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
    for (const name of this.repeats.keys()) {
      await this.queue.removeJobScheduler(name);
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue.close();
  }
}

@Global()
@Module({ providers: [JobsService], exports: [JobsService] })
export class JobsModule {}
