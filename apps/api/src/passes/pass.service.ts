import { createPrivateKey, createPublicKey, KeyObject, sign, verify } from 'node:crypto';

export interface PassPayload {
  /** Visit id */
  v: string;
  /** Premises id */
  s: string;
  /** Valid from, epoch seconds */
  f: number;
  /** Valid to, epoch seconds */
  t: number;
}

const decodeKey = (base64Pem: string) => Buffer.from(base64Pem, 'base64').toString('utf8');

/** QR pass: `v1.<payload>.<signature>`. Payload mein koi naam ya phone nahi. */
export class PassService {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;

  constructor(privateKeyB64: string, publicKeyB64: string) {
    this.privateKey = createPrivateKey(decodeKey(privateKeyB64));
    this.publicKey = createPublicKey(decodeKey(publicKeyB64));
  }

  sign(input: { visitId: string; premisesId: string; validFrom: Date; validTo: Date }): string {
    const payload: PassPayload = {
      v: input.visitId,
      s: input.premisesId,
      f: Math.floor(input.validFrom.getTime() / 1000),
      t: Math.floor(input.validTo.getTime() / 1000),
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = sign(null, Buffer.from(`v1.${body}`), this.privateKey).toString('base64url');
    return `v1.${body}.${signature}`;
  }

  verify(token: string): PassPayload | null {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') return null;
    try {
      const ok = verify(
        null,
        Buffer.from(`v1.${parts[1]}`),
        this.publicKey,
        Buffer.from(parts[2], 'base64url'),
      );
      if (!ok) return null;
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      return typeof payload?.v === 'string' && typeof payload?.s === 'string' ? (payload as PassPayload) : null;
    } catch {
      return null;
    }
  }
}
