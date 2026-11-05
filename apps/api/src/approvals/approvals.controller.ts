import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../auth/roles.decorator';
import { parseBody } from '../common/parse';
import { ApprovalsService } from './approvals.service';

const approveSchema = z.object({ note: z.string().trim().max(200).optional() });
const rejectSchema = z.object({ reason: z.string().trim().max(200).optional() });

@Controller('visits/:id')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Post('approve')
  @HttpCode(200)
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.approvals.approve(user, id, parseBody(approveSchema, body ?? {}).note);
  }

  @Post('reject')
  @HttpCode(200)
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.approvals.reject(user, id, parseBody(rejectSchema, body ?? {}).reason);
  }
}
