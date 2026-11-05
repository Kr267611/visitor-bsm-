import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles } from '../auth/roles.decorator';
import { parseBody } from '../common/parse';
import { GateService } from './gate.service';
import { WalkInService } from './walk-in.service';

const clientEventId = z.string().min(8).max(64);
const scanSchema = z.object({
  qr: z.string().min(1).max(2000),
  gateId: z.string().uuid(),
  mode: z.enum(['IN', 'OUT']),
  clientEventId,
});
const manualSchema = z.object({ gateId: z.string().uuid(), clientEventId });
const otpSchema = z.object({ phone: z.string() });
const walkInSchema = z.object({
  phone: z.string(),
  otp: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  company: z.string().trim().max(100).optional(),
  photoKey: z.string().min(1).optional(),
  hostId: z.string().uuid(),
  purpose: z.string().trim().min(1).max(200),
  gateId: z.string().uuid(),
  consent: z.boolean(),
  clientEventId,
});

@Roles('guard', 'reception')
@Controller()
export class GateController {
  constructor(
    private readonly gate: GateService,
    private readonly walkIns: WalkInService,
  ) {}

  @Post('gate/scan')
  @HttpCode(200)
  scan(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.gate.scan(user, parseBody(scanSchema, body));
  }

  @Post('visits/:id/check-in')
  @HttpCode(200)
  checkIn(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.gate.manual(user, id, 'IN', parseBody(manualSchema, body));
  }

  @Post('visits/:id/check-out')
  @HttpCode(200)
  checkOut(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.gate.manual(user, id, 'OUT', parseBody(manualSchema, body));
  }

  @Get('gate/visitors/lookup')
  lookup(@Query('phone') phone = '') {
    return this.walkIns.lookup(phone);
  }

  @Post('gate/walk-ins/otp')
  @HttpCode(204)
  async walkInOtp(@Body() body: unknown) {
    await this.walkIns.sendOtp(parseBody(otpSchema, body).phone);
  }

  @Post('gate/walk-ins')
  walkIn(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.walkIns.create(user, parseBody(walkInSchema, body));
  }
}
