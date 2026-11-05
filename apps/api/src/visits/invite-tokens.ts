import { createHash, randomBytes } from 'node:crypto';

export const hashInviteToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Link ka token sirf SMS mein jata hai. Database mein sirf uska hash. */
export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashInviteToken(token) };
}

export const inviteLink = (token: string) => `${process.env.PUBLIC_WEB_URL}/v/${token}`;
