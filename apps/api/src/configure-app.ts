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

/** Server start hone se pehle zaroori settings check. Kami ho to saaf error, baad mein ajeeb crash nahi. */
export function assertRequiredEnv(env: Record<string, string | undefined>): void {
  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Yeh settings missing hain: ${missing.join(', ')}`);
  if (env.JWT_SECRET === 'change-me') throw new Error('JWT_SECRET ko asli random value se badlein.');
}

/** Sirf poore domain. `*` ya `*.vercel.app` jaisa kuch nahi chalega. */
export function allowedOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin && !origin.includes('*'));
}

/** main.ts aur tests dono yahi setup use karte hain. */
export function configureApp(app: INestApplication): void {
  const express = app as NestExpressApplication;
  app.useGlobalFilters(new ApiErrorFilter());
  // Render ke proxy ke peeche asli visitor ka IP, warna rate limit sab par saath lagega.
  express.set('trust proxy', 1);
  express.disable('x-powered-by');
  // Photos web app ke domain par dikhani hain, isliye cross-origin allowed.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({ origin: allowedOrigins() });
}
