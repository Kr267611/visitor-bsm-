import { normalizeIndianPhone } from '@visitor/shared';
import { z, ZodTypeAny } from 'zod';
import { ApiException } from './api-exception';

/** Validates a request body. Invalid input gives 422 VALIDATION_FAILED. */
export function parseBody<S extends ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ApiException(422, 'VALIDATION_FAILED', `Invalid value: ${issue.path.join('.') || 'body'}`);
  }
  return result.data;
}

/** Converts a number to E.164. An invalid number gives 422. */
export function requirePhone(input: string): string {
  const phone = normalizeIndianPhone(input);
  if (!phone) throw new ApiException(422, 'VALIDATION_FAILED', 'Enter a valid 10-digit mobile number.');
  return phone;
}
