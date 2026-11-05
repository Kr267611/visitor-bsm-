import { Global, Module } from '@nestjs/common';
import { VisitLifecycleService } from './visit-lifecycle.service';

@Global()
@Module({
  providers: [VisitLifecycleService],
  exports: [VisitLifecycleService],
})
export class VisitsModule {}
