import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module';
import { GateController } from './gate.controller';
import { GateService } from './gate.service';
import { WalkInService } from './walk-in.service';

@Module({
  imports: [ApprovalsModule],
  controllers: [GateController],
  providers: [GateService, WalkInService],
  exports: [GateService],
})
export class GateModule {}
