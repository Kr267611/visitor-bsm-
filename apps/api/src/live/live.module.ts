import { Module } from '@nestjs/common';
import { DashboardController } from '../dashboard/dashboard.controller';
import { DashboardService } from '../dashboard/dashboard.service';
import { LiveGateway } from './live.gateway';

@Module({
  controllers: [DashboardController],
  providers: [LiveGateway, DashboardService],
})
export class LiveModule {}
