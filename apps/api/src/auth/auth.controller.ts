import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { parseBody, requirePhone } from '../common/parse';
import { AuthService } from './auth.service';
import { Public } from './roles.decorator';

const requestSchema = z.object({ phone: z.string() });
const verifySchema = z.object({
  phone: z.string(),
  otp: z.string().regex(/^\d{6}$/),
  deviceName: z.string().min(1).max(100),
});
const refreshSchema = z.object({ refreshToken: z.string().min(1) });

@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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
