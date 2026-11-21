import { Controller, Get, Query } from '@nestjs/common';
import type { StatsPeriod } from '@visitor/shared';
import { RequireFeature, RequireModule } from '../auth/permissions';
import { AuthUser, CurrentUser, Roles } from '../auth/roles.decorator';
import { ApiException } from '../common/api-exception';
import { DashboardService } from './dashboard.service';

@RequireFeature('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Roles('guard', 'reception', 'security', 'admin')
  @RequireModule('desk')
  @Get('live')
  live(@CurrentUser() user: AuthUser) {
    if (!user.premisesId) throw new ApiException(422, 'VALIDATION_FAILED', 'Your account has no premises assigned.');
    return this.dashboard.live(user.premisesId);
  }

  /** Counts and charts for the user's premises. */
  @Roles('reception', 'security', 'admin')
  @RequireModule('desk')
  @Get('stats')
  stats(@CurrentUser() user: AuthUser, @Query('period') period?: string) {
    if (!user.premisesId) throw new ApiException(422, 'VALIDATION_FAILED', 'Your account has no premises assigned.');
    const chosen: StatsPeriod = period === 'today' || period === 'year' ? period : 'month';
    return this.dashboard.stats(user.premisesId, chosen);
  }
}
