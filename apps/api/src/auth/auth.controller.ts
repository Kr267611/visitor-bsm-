import { Body, Controller, HttpCode, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { parseBody, requirePhone } from '../common/parse';
import { AuthService } from './auth.service';
import { PASSWORD_MAX, PASSWORD_MIN } from './password';
import { AuthUser, CurrentUser, Public } from './roles.decorator';

const deviceName = z.string().min(1).max(100);
const requestSchema = z.object({ phone: z.string() });
const verifySchema = z.object({ phone: z.string(), otp: z.string().regex(/^\d{6}$/), deviceName });
const loginSchema = z.object({
  identifier: z.string().min(3).max(200),
  password: z.string().min(1).max(PASSWORD_MAX),
  deviceName,
});
const selectSchema = z.object({
  selectionToken: z.string().min(20).max(100),
  businessId: z.string().uuid().nullable(),
  deviceName,
});
const refreshSchema = z.object({ refreshToken: z.string().min(1) });
const passwordSchema = z.object({
  currentPassword: z.string().max(PASSWORD_MAX).optional(),
  newPassword: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
});

const authLimit = { default: { limit: () => Number(process.env.AUTH_RATE_LIMIT ?? 20), ttl: 60_000 } };

@Public()
@Throttle(authLimit)
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown) {
    const { identifier, password, deviceName } = parseBody(loginSchema, body);
    return this.auth.login(identifier, password, deviceName);
  }

  @Post('otp/request')
  @HttpCode(204)
  async request(@Body() body: unknown) {
    const { phone } = parseBody(requestSchema, body);
    await this.auth.requestOtp(requirePhone(phone));
  }

  @Post('otp/verify')
  @HttpCode(200)
  verify(@Body() body: unknown) {
    const { phone, otp, deviceName } = parseBody(verifySchema, body);
    return this.auth.verifyOtp(requirePhone(phone), otp, deviceName);
  }

  @Post('select-business')
  @HttpCode(200)
  select(@Body() body: unknown) {
    const { selectionToken, businessId, deviceName } = parseBody(selectSchema, body);
    return this.auth.selectBusiness(selectionToken, businessId, deviceName);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: unknown) {
    return this.auth.refresh(parseBody(refreshSchema, body).refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() body: unknown) {
    await this.auth.logout(parseBody(refreshSchema, body).refreshToken);
  }
}

@Throttle(authLimit)
@Controller('me')
export class PasswordController {
  constructor(private readonly auth: AuthService) {}

  @Put('password')
  @HttpCode(204)
  async change(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { currentPassword, newPassword } = parseBody(passwordSchema, body);
    await this.auth.changePassword(user.id, user.deviceId, currentPassword, newPassword);
  }
}
