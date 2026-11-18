import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import { ApiException } from '../common/api-exception';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from './otp.service';

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ROTATION_GRACE_MS = 30_000;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const invalidSession = () => new ApiException(401, 'UNAUTHORIZED', 'Dobara login karein.');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly otp: OtpService,
  ) {}

  /** F3 mein yahan kai businesses ka chunav aayega; abhi pehla active account. */
  private activeUserByPhone(phone: string) {
    return this.prisma.user.findFirst({
      where: { phone, isActive: true, OR: [{ businessId: null }, { business: { isActive: true } }] },
      orderBy: { createdAt: 'asc' },
    });
  }

  async requestOtp(phone: string): Promise<void> {
    const user = await this.activeUserByPhone(phone);
    if (!user?.isActive) return; // Bahar wale ko pata na chale kaun employee hai.
    await this.otp.request(phone, 'LOGIN_OTP');
  }

  async verifyOtp(phone: string, otp: string, deviceName: string) {
    const user = await this.activeUserByPhone(phone);
    const ok = user?.isActive && (await this.otp.verify(phone, otp, 'LOGIN_OTP'));
    if (!user || !ok) throw new ApiException(401, 'INVALID_OTP', 'OTP sahi nahi hai.');

    const device = await this.prisma.device.create({ data: { userId: user.id, name: deviceName } });
    return {
      ...(await this.issueTokens(user, device.id)),
      user: { id: user.id, name: user.name, role: user.role, businessId: user.businessId },
      deviceId: device.id,
    };
  }

  async refresh(refreshToken: string) {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: true, device: true },
    });
    // Jawab raaste mein kho jaye ya do tabs ek saath refresh karein to logout na ho: 30 second ki chhoot.
    const graceOver = stored?.revokedAt && Date.now() - stored.revokedAt.getTime() > ROTATION_GRACE_MS;
    if (
      !stored ||
      graceOver ||
      stored.expiresAt < new Date() ||
      stored.device.revokedAt ||
      !stored.user.isActive
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
      // Logout ke baad is phone par visitors ke naam wale push nahi aane chahiye.
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
    const accessToken = await this.jwt.signAsync({ sub: user.id, deviceId });
    return { accessToken, refreshToken };
  }
}
