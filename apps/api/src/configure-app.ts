import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ApiErrorFilter } from './common/api-error.filter';

/** main.ts aur tests dono yahi setup use karte hain. */
export function configureApp(app: INestApplication): void {
  app.useGlobalFilters(new ApiErrorFilter());
  // Render ke proxy ke peeche asli visitor ka IP, warna rate limit sab par saath lagega.
  (app as NestExpressApplication).set('trust proxy', 1);
}
