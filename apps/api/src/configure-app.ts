import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { ApiErrorFilter } from './common/api-error.filter';

const REQUIRED_ENV = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'QR_PRIVATE_KEY',
  'QR_PUBLIC_KEY',
  'PUBLIC_WEB_URL',
  'API_URL',
  'CONSENT_VERSION',
];

/** Render provides its own public URL, so API_URL does not have to be set separately. */
export function applyPlatformDefaults(env: Record<string, string | undefined>): void {
  env.API_URL ??= env.RENDER_EXTERNAL_URL;
}

/** Checks required settings before the server starts: a clear error now instead of a strange crash later. */
export function assertRequiredEnv(env: Record<string, string | undefined>): void {
  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Missing required settings: ${missing.join(', ')}`);
  if (env.JWT_SECRET === 'change-me') throw new Error('Replace JWT_SECRET with a real random value.');
}

/** Full domains only. Wildcards such as `*` or `*.vercel.app` are ignored. */
export function allowedOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin && !origin.includes('*'));
}

/** Shared setup for main.ts and the tests. */
export function configureApp(app: INestApplication): void {
  const express = app as NestExpressApplication;
  app.useGlobalFilters(new ApiErrorFilter());
  // Real client IP behind Render's proxy; otherwise the rate limit would hit everyone at once.
  express.set('trust proxy', 1);
  express.disable('x-powered-by');
  // Photos are shown on the web app's domain, so cross-origin loading is allowed.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({ origin: allowedOrigins() });
}
