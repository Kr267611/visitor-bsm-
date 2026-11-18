import { Controller, Get } from '@nestjs/common';
import { RequireFeature } from '../auth/permissions';
import { AuthUser, CurrentUser, Roles } from '../auth/roles.decorator';
import { ApiException } from '../common/api-exception';
import { DashboardService } from './dashboard.service';

@RequireFeature('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Roles('guard', 'reception', 'security', 'admin')
  @Get('live')
  live(@CurrentUser() user: AuthUser) {
    if (!user.premisesId) throw new ApiException(422, 'VALIDATION_FAILED', 'Your account has no premises assigned.');
    return this.dashboard.live(user.premisesId);
  }
}
