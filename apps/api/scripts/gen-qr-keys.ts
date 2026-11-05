// Naya QR signing key pair banata hai. Chalayein: npx tsx scripts/gen-qr-keys.ts
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const toEnv = (pem: string | Buffer) => Buffer.from(pem).toString('base64');

console.log(`QR_PRIVATE_KEY=${toEnv(privateKey.export({ type: 'pkcs8', format: 'pem' }))}`);
console.log(`QR_PUBLIC_KEY=${toEnv(publicKey.export({ type: 'spki', format: 'pem' }))}`);
