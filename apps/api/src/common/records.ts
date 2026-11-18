import { randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { ApiException } from './api-exception';

/** Prisma ke unique/foreign-key errors ko saaf 422 mein badalta hai. */
export async function friendly<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') throw new ApiException(422, 'VALIDATION_FAILED', 'Yeh pehle se maujood hai.');
      if (e.code === 'P2003') throw new ApiException(422, 'VALIDATION_FAILED', 'Chuna gaya premises, gate ya department nahi mila.');
      if (e.code === 'P2025') throw new ApiException(404, 'NOT_FOUND', 'Yeh record nahi mila.');
    }
    throw e;
  }
}

export const notFound = () => new ApiException(404, 'NOT_FOUND', 'Yeh record nahi mila.');

const KIOSK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Kiosk par premises pehchanne ka 6 akshar ka code (0/O, 1/I jaise milte-julte nahi). */
export const kioskCode = () => Array.from({ length: 6 }, () => KIOSK_ALPHABET[randomInt(KIOSK_ALPHABET.length)]).join('');

export const slugify = (name: string, fallback = 'premises') =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || fallback;
