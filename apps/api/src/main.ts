import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import * as Sentry from '@sentry/node';
import { AppModule } from './app.module';
import { assertRequiredEnv, configureApp } from './configure-app';
import { JobsService } from './jobs/jobs.service';

async function bootstrap() {
  assertRequiredEnv(process.env);
  if (process.env.SENTRY_DSN) Sentry.init({ dsn: process.env.SENTRY_DSN });

  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
  await app.get(JobsService).startWorker();
}

void bootstrap();
