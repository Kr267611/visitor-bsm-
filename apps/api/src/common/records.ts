import { randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { ApiException } from './api-exception';

/** Turns Prisma unique/foreign-key errors into a clean 422. */
export async function friendly<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') throw new ApiException(422, 'VALIDATION_FAILED', 'This already exists.');
      if (e.code === 'P2003') throw new ApiException(422, 'VALIDATION_FAILED', 'The selected premises, gate or department was not found.');
      if (e.code === 'P2025') throw new ApiException(404, 'NOT_FOUND', 'Record not found.');
    }
    throw e;
  }
}

/** The request id (clientEventId) belongs to someone else: no replay, a clean 422 instead of a 500. */
export const usedRequestId = () =>
  new ApiException(422, 'VALIDATION_FAILED', 'This request ID has already been used. Please try again.');

export const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export const notFound = () => new ApiException(404, 'NOT_FOUND', 'Record not found.');

const KIOSK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** 6-character code a kiosk uses to identify its premises (no look-alikes such as 0/O or 1/I). */
export const kioskCode = () => Array.from({ length: 6 }, () => KIOSK_ALPHABET[randomInt(KIOSK_ALPHABET.length)]).join('');

export const slugify = (name: string, fallback = 'premises') =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || fallback;
