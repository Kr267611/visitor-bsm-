import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../common/api-exception';
import { SMS_PROVIDER, SmsProvider } from '../notifications/sms.provider';
import { RedisService } from '../redis/redis.service';

const OTP_TTL_SEC = 5 * 60;
const MAX_ATTEMPTS = 5;
const RATE_WINDOW_SEC = 10 * 60;
const MAX_DAILY_FAILURES = 30;
const DAY_SEC = 24 * 60 * 60;
const MAX_REQUESTS = 3;

export type OtpPurpose = 'LOGIN_OTP' | 'WALKIN_OTP' | 'SELF_CHECKIN_OTP';

const entryOtp = (otp: string) =>
  `Your gate entry OTP is ${otp}. Your details will be stored for the visitor record: ${process.env.PUBLIC_WEB_URL}/privacy`;

const TEXT: Record<OtpPurpose, (otp: string) => string> = {
  // Same text as the walk-in OTP, so one DLT template covers both.
  SELF_CHECKIN_OTP: entryOtp,
  LOGIN_OTP: (otp) => `Your sign-in OTP is ${otp}. It expires in 5 minutes.`,
  WALKIN_OTP: entryOtp,
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

  /** The OTP goes straight out by SMS, not through the outbox, so it never sits in the database. */
  async request(phone: string, purpose: OtpPurpose): Promise<void> {
    const rateKey = `otp-rate:${purpose}:${phone}`;
    const count = await this.redis.client.incr(rateKey);
    if (count === 1) await this.redis.client.expire(rateKey, RATE_WINDOW_SEC);
    if (count > MAX_REQUESTS) {
      throw new ApiException(429, 'OTP_RATE_LIMITED', 'Too many OTP requests. Please try again in 10 minutes.');
    }

    const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const key = `otp:${purpose}:${phone}`;
    await this.redis.client
      .multi()
      .del(key)
      .hset(key, { hash: this.hash(phone, otp), attempts: 0 })
      .expire(key, OTP_TTL_SEC)
      .exec();
    try {
      await this.sms.send(phone, TEXT[purpose](otp));
    } catch {
      // An SMS that was never sent does not count against the limit.
      await this.redis.client.decr(rateKey);
      await this.redis.client.del(key);
      throw new ApiException(503, 'SMS_UNAVAILABLE', 'SMS is unavailable right now. Please try again shortly, or use the paper register.');
    }
  }

  async verify(phone: string, otp: string, purpose: OtpPurpose): Promise<boolean> {
    const key = `otp:${purpose}:${phone}`;
    const failKey = `otp-fail:${purpose}:${phone}`;
    const stored = await this.redis.client.hget(key, 'hash');
    if (!stored) return false;
    if (Number(await this.redis.client.get(failKey)) >= MAX_DAILY_FAILURES) return false;

    // Count the attempt first so parallel requests cannot slip past the limit.
    const attempts = await this.redis.client.hincrby(key, 'attempts', 1);
    if (attempts > MAX_ATTEMPTS) return false;

    const ok = timingSafeEqual(Buffer.from(stored), Buffer.from(this.hash(phone, otp)));
    if (ok) {
      await this.redis.client.del(key);
    } else {
      const fails = await this.redis.client.incr(failKey);
      if (fails === 1) await this.redis.client.expire(failKey, DAY_SEC);
    }
    return ok;
  }
}
