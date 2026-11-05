import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import { ApiException } from '../common/api-exception';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from './otp.service';

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const invalidSession = () => new ApiException(401, 'UNAUTHORIZED', 'Dobara login karein.');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly otp: OtpService,
  ) {}

  async requestOtp(phone: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user?.isActive) return; // Bahar wale ko pata na chale kaun employee hai.
    await this.otp.request(phone, 'LOGIN_OTP');
  }

  async verifyOtp(phone: string, otp: string, deviceName: string) {
    const user = await this.prisma.user.findUnique({ where: { phone } });
    const ok = user?.isActive && (await this.otp.verify(phone, otp, 'LOGIN_OTP'));
    if (!user || !ok) throw new ApiException(401, 'INVALID_OTP', 'OTP sahi nahi hai.');

    const device = await this.prisma.device.create({ data: { userId: user.id, name: deviceName } });
    return {
      ...(await this.issueTokens(user, device.id)),
      user: { id: user.id, name: user.name, role: user.role, siteId: user.siteId },
      deviceId: device.id,
    };
  }

  async refresh(refreshToken: string) {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: true, device: true },
    });
    if (
      !stored ||
      stored.revokedAt ||
      stored.expiresAt < new Date() ||
      stored.device.revokedAt ||
      !stored.user.isActive
    ) {
      throw invalidSession();
    }
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count !== 1) throw invalidSession();
    return this.issueTokens(stored.user, stored.deviceId);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
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
