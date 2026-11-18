import { randomBytes, scrypt as scryptCb, ScryptOptions, timingSafeEqual } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const MAXMEM = 64 * 1024 * 1024;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

function scrypt(password: string, salt: Buffer, keyLen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize('NFKC'), salt, keyLen, options, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** Format: `scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

// Jinka password set nahi, unke liye bhi utna hi time lage, taaki timing se pata na chale.
const DUMMY = `scrypt$${N}$${R}$${P}$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(KEY_LEN).toString('base64')}`;

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const parts = (stored ?? DUMMY).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  // Database mein koi ajeeb value ho to server atak na jaye.
  if (!(n >= 1024 && n <= 2 ** 17 && r >= 1 && r <= 16 && p >= 1 && p <= 4)) return false;
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (expected.length < 16) return false;
  const actual = await scrypt(password, salt, expected.length, { N: n, r, p, maxmem: MAXMEM });
  return timingSafeEqual(actual, expected) && stored != null;
}
