import { generateKeyPairSync } from 'node:crypto';
import { PassService } from './pass.service';

function keys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    pub: Buffer.from(publicKey.export({ type: 'spki', format: 'pem' })).toString('base64'),
    priv: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64'),
  };
}

describe('PassService', () => {
  const input = {
    visitId: '11111111-1111-1111-1111-111111111111',
    premisesId: '22222222-2222-2222-2222-222222222222',
    validFrom: new Date('2026-11-05T04:30:00Z'),
    validTo: new Date('2026-11-05T07:30:00Z'),
  };
  const k = keys();
  const service = new PassService(k.priv, k.pub);

  it('sign then verify returns payload', () => {
    expect(service.verify(service.sign(input))).toEqual({
      v: input.visitId,
      s: input.premisesId,
      f: 1793853000,
      t: 1793863800,
    });
  });

  it('token starts with v1.', () => {
    expect(service.sign(input).startsWith('v1.')).toBe(true);
  });

  it('payload has no name or phone', () => {
    const body = JSON.parse(Buffer.from(service.sign(input).split('.')[1], 'base64url').toString());
    expect(Object.keys(body).sort()).toEqual(['f', 's', 't', 'v']);
  });

  it('tampered payload returns null', () => {
    const [v, , sig] = service.sign(input).split('.');
    const forged = Buffer.from(JSON.stringify({ v: 'other', s: 'x', f: 1, t: 2 })).toString('base64url');
    expect(service.verify(`${v}.${forged}.${sig}`)).toBeNull();
  });

  it('other key signature returns null', () => {
    const other = keys();
    expect(service.verify(new PassService(other.priv, other.pub).sign(input))).toBeNull();
  });

  it.each(['', 'abc', 'v1.x', 'v2.a.b', 'v1.!!!.???', 'v1.e30.AAAA'])('garbage "%s" returns null', (t) => {
    expect(service.verify(t)).toBeNull();
  });
});
