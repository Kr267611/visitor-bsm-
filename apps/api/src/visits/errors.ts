import type { VisitStatus } from '@visitor/shared';
import { ApiException } from '../common/api-exception';

export class InvalidTransitionError extends ApiException {
  constructor(readonly current: VisitStatus) {
    super(409, 'INVALID_TRANSITION', `Yeh visit abhi ${current} hai, yeh kaam nahi ho sakta.`, {
      status: current,
    });
  }
}
