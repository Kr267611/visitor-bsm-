import { Controller, Get } from '@nestjs/common';
import { AuthUser, CurrentUser, Roles } from '../auth/roles.decorator';
import { ApiException } from '../common/api-exception';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Roles('guard', 'reception', 'security', 'admin')
  @Get('live')
  live(@CurrentUser() user: AuthUser) {
    if (!user.siteId) throw new ApiException(422, 'VALIDATION_FAILED', 'Aapke account par site set nahi hai.');
    return this.dashboard.live(user.siteId);
  }
}
