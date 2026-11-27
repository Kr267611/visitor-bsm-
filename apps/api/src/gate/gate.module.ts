import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module';
import { GateController } from './gate.controller';
import { GatePassController } from './gate-pass.controller';
import { GateService } from './gate.service';
import { WalkInService } from './walk-in.service';

@Module({
  imports: [ApprovalsModule],
  controllers: [GateController, GatePassController],
  providers: [GateService, WalkInService],
  exports: [GateService],
})
export class GateModule {}
