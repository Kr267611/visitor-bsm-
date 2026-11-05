import { Global, Module } from '@nestjs/common';
import { UploadsController } from '../storage/uploads.controller';
import { ExpiryJob } from './expiry.job';
import { PublicInvitesController } from './public-invites.controller';
import { RetentionJob } from './retention.job';
import { VisitLifecycleService } from './visit-lifecycle.service';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';

@Global()
@Module({
  controllers: [VisitsController, PublicInvitesController, UploadsController],
  providers: [VisitLifecycleService, VisitsService, ExpiryJob, RetentionJob],
  exports: [VisitLifecycleService, VisitsService],
})
export class VisitsModule {}
