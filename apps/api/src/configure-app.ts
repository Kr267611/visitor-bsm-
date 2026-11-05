import type { INestApplication } from '@nestjs/common';
import { ApiErrorFilter } from './common/api-error.filter';

/** main.ts aur tests dono yahi setup use karte hain. */
export function configureApp(app: INestApplication): void {
  app.useGlobalFilters(new ApiErrorFilter());
}
