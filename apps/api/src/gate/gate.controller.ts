import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles } from '../auth/roles.decorator';
import { parseBody } from '../common/parse';
import { GateService } from './gate.service';

const clientEventId = z.string().min(8).max(64);
const scanSchema = z.object({
  qr: z.string().min(1).max(2000),
  gateId: z.string().uuid(),
  mode: z.enum(['IN', 'OUT']),
  clientEventId,
});
const manualSchema = z.object({ gateId: z.string().uuid(), clientEventId });

@Roles('guard', 'reception')
@Controller()
export class GateController {
  constructor(private readonly gate: GateService) {}

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
}
