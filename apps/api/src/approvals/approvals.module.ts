import { Module } from '@nestjs/common';
import { ApprovalTimerProcessor } from './approval-timer.processor';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';

@Module({
  controllers: [ApprovalsController],
  providers: [ApprovalsService, ApprovalTimerProcessor],
  exports: [ApprovalTimerProcessor],
})
export class ApprovalsModule {}
