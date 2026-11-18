import { createHash, randomBytes } from 'node:crypto';

export const hashInviteToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** The link token only travels in the SMS. The database stores only its hash. */
export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashInviteToken(token) };
}

export const inviteLink = (token: string) => `${process.env.PUBLIC_WEB_URL}/v/${token}`;
