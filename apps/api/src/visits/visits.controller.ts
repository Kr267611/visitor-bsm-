import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { VISIT_STATUSES } from '@visitor/shared';
import { z } from 'zod';
import { RequireFeature } from '../auth/permissions';
import { AuthUser, CurrentUser, Roles } from '../auth/roles.decorator';
import { parseBody } from '../common/parse';
import { VisitsService } from './visits.service';

const inviteSchema = z.object({
  visitorName: z.string().trim().min(1).max(100),
  visitorPhone: z.string(),
  validFrom: z.coerce.date(),
  validTo: z.coerce.date(),
  purpose: z.string().trim().min(1).max(200),
});

const listSchema = z.object({
  scope: z.enum(['mine', 'site']).default('mine'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(VISIT_STATUSES).optional(),
});

@Controller('visits')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Roles('employee', 'reception', 'admin')
  @RequireFeature('invites')
  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const visit = await this.visits.invite(user, parseBody(inviteSchema, body));
    return { id: visit.id, code: visit.code, status: visit.status };
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    return this.visits.list(user, parseBody(listSchema, query));
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.visits.get(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.visits.cancel(user, id);
  }

  @Post(':id/resend-invite')
  @HttpCode(204)
  async resend(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.visits.resendInvite(user, id);
  }
}
