import { Global, Module } from '@nestjs/common';
import { UploadsController } from '../storage/uploads.controller';
import { PublicInvitesController } from './public-invites.controller';
import { VisitLifecycleService } from './visit-lifecycle.service';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';

@Global()
@Module({
  controllers: [VisitsController, PublicInvitesController, UploadsController],
  providers: [VisitLifecycleService, VisitsService],
  exports: [VisitLifecycleService, VisitsService],
})
export class VisitsModule {}
