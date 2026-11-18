import type { VisitStatus } from '@visitor/shared';
import { ApiException } from '../common/api-exception';

export class InvalidTransitionError extends ApiException {
  constructor(readonly current: VisitStatus) {
    super(409, 'INVALID_TRANSITION', `This visit is ${current}; this action is not allowed.`, {
      status: current,
    });
  }
}
