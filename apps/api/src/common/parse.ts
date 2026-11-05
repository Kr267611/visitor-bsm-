import { normalizeIndianPhone } from '@visitor/shared';
import { z, ZodTypeAny } from 'zod';
import { ApiException } from './api-exception';

/** Request body check karta hai. Galat ho to 422 VALIDATION_FAILED. */
export function parseBody<S extends ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ApiException(422, 'VALIDATION_FAILED', `Sahi jaankari bhejein: ${issue.path.join('.') || 'body'}`);
  }
  return result.data;
}

/** Number ko E.164 mein badalta hai. Galat number par 422. */
export function requirePhone(input: string): string {
  const phone = normalizeIndianPhone(input);
  if (!phone) throw new ApiException(422, 'VALIDATION_FAILED', 'Mobile number sahi nahi hai.');
  return phone;
}
