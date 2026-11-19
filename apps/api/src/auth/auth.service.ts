import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User } from '@prisma/client';
import { normalizeIndianPhone } from '@visitor/shared';
import { ApiException } from '../common/api-exception';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { OtpService } from './otp.service';
import { hashPassword, verifyPassword } from './password';

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ROTATION_GRACE_MS = 30_000;
const SELECTION_TTL_SEC = 5 * 60;
const MAX_PASSWORD_FAILS = 10;
const PASSWORD_LOCK_SEC = 15 * 60;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const invalidSession = () => new ApiException(401, 'UNAUTHORIZED', 'Please sign in again.');

/** Active user whose business is also active (a super admin has no business). */
const ACTIVE_ACCOUNT: Prisma.UserWhereInput = {
  isActive: true,
  OR: [{ businessId: null }, { business: { isActive: true } }],
};

type Account = User & { business: { name: string; otpLogin: boolean } | null };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly otp: OtpService,
    private readonly redis: RedisService,
  ) {}

  /** One phone/email can exist in several businesses: all active accounts. Sign-in lookups search every business. */
  private accounts(where: Prisma.UserWhereInput): Promise<Account[]> {
    return this.prisma.user.findMany({
      where: { AND: [ACTIVE_ACCOUNT, where] },
      include: { business: { select: { name: true, otpLogin: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  private byIdentifier(identifier: string): Promise<Account[]> {
    const value = identifier.trim();
    if (value.includes('@')) return this.accounts({ email: { equals: value, mode: 'insensitive' } });
    const phone = normalizeIndianPhone(value);
    return phone ? this.accounts({ phone }) : Promise.resolve([]);
  }

  /** OTP only for businesses that have OTP sign-in enabled. */
  private otpAccounts(phone: string) {
    return this.accounts({ phone }).then((all) => all.filter((u) => !u.business || u.business.otpLogin));
  }

  async login(identifier: string, password: string, deviceName: string) {
    const failKey = `login-fail:${sha256(identifier.trim().toLowerCase())}`;
    if (Number(await this.redis.client.get(failKey)) >= MAX_PASSWORD_FAILS) {
      throw new ApiException(429, 'LOGIN_LOCKED', 'Too many incorrect passwords. Please try again in 15 minutes.');
    }
    const candidates = await this.byIdentifier(identifier);
    const matched: Account[] = [];
    for (const user of candidates) {
      if (await verifyPassword(password, user.passwordHash)) matched.push(user);
    }
    if (!candidates.length) await verifyPassword(password, null);
    if (!matched.length) {
      const fails = await this.redis.client.incr(failKey);
      if (fails === 1) await this.redis.client.expire(failKey, PASSWORD_LOCK_SEC);
      throw new ApiException(401, 'INVALID_CREDENTIALS', 'Incorrect phone/email or password.');
    }
    await this.redis.client.del(failKey);
    return this.finish(matched, deviceName);
  }

  async requestOtp(phone: string): Promise<void> {
    // Never reveal who is an employee: answer 204 even when there is no account.
    if (!(await this.otpAccounts(phone)).length) return;
    await this.otp.request(phone, 'LOGIN_OTP');
  }

  async verifyOtp(phone: string, otp: string, deviceName: string) {
    const candidates = await this.otpAccounts(phone);
    const ok = candidates.length > 0 && (await this.otp.verify(phone, otp, 'LOGIN_OTP'));
    if (!ok) throw new ApiException(401, 'INVALID_OTP', 'Incorrect OTP.');
    return this.finish(candidates, deviceName);
  }

  /**
   * The business list is shown only after proof (password/OTP). One account gives a session directly;
   * several give 409 CHOOSE_BUSINESS with a one-time selection token valid for 5 minutes.
   */
  private async finish(users: Account[], deviceName: string) {
    if (users.length === 1) return this.session(users[0], deviceName);
    const selectionToken = randomBytes(32).toString('base64url');
    await this.redis.client.set(
      `login-select:${sha256(selectionToken)}`,
      JSON.stringify(users.map((u) => u.id)),
      'EX',
      SELECTION_TTL_SEC,
    );
    throw new ApiException(409, 'CHOOSE_BUSINESS', 'Which business do you want to sign in to?', {
      selectionToken,
      businesses: users.map((u) => ({ id: u.businessId, name: u.business?.name ?? 'Platform' })),
    });
  }

  async selectBusiness(selectionToken: string, businessId: string | null, deviceName: string) {
    // GET + DEL in one MULTI so the token works only once. Works on Redis 5 too (GETDEL needs 6.2+).
    const key = `login-select:${sha256(selectionToken)}`;
    const result = await this.redis.client.multi().get(key).del(key).exec();
    const raw = result?.[0]?.[1] as string | null | undefined;
    if (!raw) throw new ApiException(401, 'UNAUTHORIZED', 'Sign-in timed out. Please sign in again.');
    const [user] = await this.accounts({ id: { in: JSON.parse(raw) as string[] }, businessId });
    if (!user) throw new ApiException(401, 'UNAUTHORIZED', 'Please sign in again.');
    return this.session(user, deviceName);
  }

  private async session(user: User, deviceName: string) {
    const device = await this.prisma.device.create({ data: { userId: user.id, name: deviceName } });
    // A real sign-in (password or OTP), not a token refresh: shown as "Last login" to admins.
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return {
      ...(await this.issueTokens(user, device.id)),
      user: { id: user.id, name: user.name, role: user.role, businessId: user.businessId },
      deviceId: device.id,
    };
  }

  /** Changing the password signs out every other device. The first password (OTP user) needs no current password. */
  async changePassword(userId: string, deviceId: string, currentPassword: string | undefined, newPassword: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.passwordHash && !(currentPassword && (await verifyPassword(currentPassword, user.passwordHash)))) {
      throw new ApiException(422, 'VALIDATION_FAILED', 'The current password is incorrect.');
    }
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } }),
      this.prisma.refreshToken.updateMany({
        where: { userId, deviceId: { not: deviceId }, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.device.updateMany({
        where: { userId, id: { not: deviceId }, revokedAt: null },
        data: { revokedAt: now, pushToken: null },
      }),
    ]);
  }

  async refresh(refreshToken: string) {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: { include: { business: { select: { isActive: true } } } }, device: true },
    });
    // If the response is lost or two tabs refresh at once, do not sign out: 30-second grace period.
    const graceOver = stored?.revokedAt && Date.now() - stored.revokedAt.getTime() > ROTATION_GRACE_MS;
    if (
      !stored ||
      graceOver ||
      stored.expiresAt < new Date() ||
      stored.device.revokedAt ||
      !stored.user.isActive ||
      (stored.user.businessId && !stored.user.business?.isActive)
    ) {
      throw invalidSession();
    }
    await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(stored.user, stored.deviceId);
  }

  async logout(refreshToken: string): Promise<void> {
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (!stored) return;
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({ where: { deviceId: stored.deviceId, revokedAt: null }, data: { revokedAt: now } }),
      // After sign-out this phone must not receive pushes with visitor names.
      this.prisma.device.update({ where: { id: stored.deviceId }, data: { revokedAt: now, pushToken: null } }),
    ]);
  }

  private async issueTokens(user: User, deviceId: string) {
    const refreshToken = randomBytes(32).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        deviceId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    const accessToken = await this.jwt.signAsync({ sub: user.id, deviceId, businessId: user.businessId });
    return { accessToken, refreshToken };
  }
}
