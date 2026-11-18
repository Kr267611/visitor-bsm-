import { Injectable } from '@nestjs/common';
import { AuthUser } from '../auth/roles.decorator';
import { ApiException } from '../common/api-exception';
import { inviteLink, newInviteToken } from '../visits/invite-tokens';
import { VisitLifecycleService } from '../visits/visit-lifecycle.service';
import { VisitsService } from '../visits/visits.service';
import { ApprovalTimerProcessor } from './approval-timer.processor';

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly visits: VisitsService,
    private readonly lifecycle: VisitLifecycleService,
    private readonly timers: ApprovalTimerProcessor,
  ) {}

  private async loadForDecision(user: AuthUser, id: string) {
    const visit = await this.visits.load(id);
    const allowed =
      this.visits.isHostOrDelegate(user, visit) || this.visits.isSiteStaff(user, visit, ['reception', 'admin']);
    if (!allowed) throw new ApiException(403, 'FORBIDDEN', 'You do not have permission to do this.');
    return visit;
  }

  async approve(user: AuthUser, id: string, note?: string) {
    const visit = await this.loadForDecision(user, id);
    // The visitor needs a pass for the exit scan too.
    const { token, hash } = newInviteToken();
    const updated = await this.lifecycle.apply({
      visitId: id,
      action: 'APPROVE',
      actorId: user.id,
      deviceId: user.deviceId,
      meta: note ? { note } : undefined,
      patch: { inviteTokenHash: hash },
      notify: [
        {
          channel: 'SMS',
          template: 'PASS_READY',
          recipient: visit.visitor.phone,
          vars: { link: inviteLink(token) },
        },
      ],
    });
    await this.timers.cancel(id);
    return { id: updated.id, status: updated.status };
  }

  async reject(user: AuthUser, id: string, reason?: string) {
    await this.loadForDecision(user, id);
    const updated = await this.lifecycle.apply({
      visitId: id,
      action: 'REJECT',
      actorId: user.id,
      deviceId: user.deviceId,
      meta: reason ? { note: reason } : undefined,
    });
    await this.timers.cancel(id);
    return { id: updated.id, status: updated.status };
  }
}
