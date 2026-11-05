import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../common/api-exception';
import { SMS_PROVIDER, SmsProvider } from '../notifications/sms.provider';
import { RedisService } from '../redis/redis.service';

const OTP_TTL_SEC = 5 * 60;
const MAX_ATTEMPTS = 5;
const RATE_WINDOW_SEC = 10 * 60;
const MAX_REQUESTS = 3;

export type OtpPurpose = 'LOGIN_OTP' | 'WALKIN_OTP';

const TEXT: Record<OtpPurpose, (otp: string) => string> = {
  LOGIN_OTP: (otp) => `Aapka login OTP ${otp} hai. 5 minute mein expire hoga.`,
  WALKIN_OTP: (otp) =>
    `Gate entry ka OTP ${otp} hai. Aapki details visitor record ke liye save hongi: ${process.env.PUBLIC_WEB_URL}/privacy`,
};

@Injectable()
export class OtpService {
  constructor(
    private readonly redis: RedisService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  private hash(phone: string, otp: string): string {
    return createHmac('sha256', process.env.JWT_SECRET as string).update(`${phone}:${otp}`).digest('hex');
  }

  /** OTP sidha SMS se jata hai, outbox se nahi, taaki database mein na rahe. */
  async request(phone: string, purpose: OtpPurpose): Promise<void> {
    const rateKey = `otp-rate:${purpose}:${phone}`;
    const count = await this.redis.client.incr(rateKey);
    if (count === 1) await this.redis.client.expire(rateKey, RATE_WINDOW_SEC);
    if (count > MAX_REQUESTS) {
      throw new ApiException(429, 'OTP_RATE_LIMITED', 'Bahut baar OTP maanga gaya. 10 minute baad koshish karein.');
    }

    const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const key = `otp:${purpose}:${phone}`;
    await this.redis.client
      .multi()
      .del(key)
      .hset(key, { hash: this.hash(phone, otp), attempts: 0 })
      .expire(key, OTP_TTL_SEC)
      .exec();
    await this.sms.send(phone, TEXT[purpose](otp));
  }

  async verify(phone: string, otp: string, purpose: OtpPurpose): Promise<boolean> {
    const key = `otp:${purpose}:${phone}`;
    const stored = await this.redis.client.hget(key, 'hash');
    if (!stored) return false;

    // Pehle attempt ginte hain, taaki parallel requests limit par se na nikal sakein.
    const attempts = await this.redis.client.hincrby(key, 'attempts', 1);
    if (attempts > MAX_ATTEMPTS) return false;

    const ok = timingSafeEqual(Buffer.from(stored), Buffer.from(this.hash(phone, otp)));
    if (ok) await this.redis.client.del(key);
    return ok;
  }
}
