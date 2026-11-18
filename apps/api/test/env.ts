process.env.DATABASE_URL = 'postgresql://visitor:visitor@localhost:5433/visitor_test';
process.env.REDIS_URL = 'redis://localhost:6380/1';
process.env.JWT_SECRET = 'test-secret';
process.env.PUBLIC_WEB_URL = 'http://web.test';
process.env.API_URL = 'http://api.test';
process.env.CONSENT_VERSION = 'v1';
process.env.SMS_PROVIDER = 'fake';

// Fresh QR key pair for every test run.
import { generateKeyPairSync } from 'node:crypto';
const qrKeys = generateKeyPairSync('ed25519');
process.env.QR_PRIVATE_KEY = Buffer.from(qrKeys.privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
process.env.QR_PUBLIC_KEY = Buffer.from(qrKeys.publicKey.export({ type: 'spki', format: 'pem' })).toString('base64');
process.env.PUSH_PROVIDER = 'fake';
process.env.STORAGE_DRIVER = 'memory';
process.env.PUBLIC_RATE_LIMIT = '100000';
process.env.AUTH_RATE_LIMIT = '100000';
