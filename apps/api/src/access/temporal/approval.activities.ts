import type { Repository } from 'typeorm';
import type { AccessRequestEntity } from '../entities/access-request.entity.js';
import type { ApprovalEventEntity } from '../entities/approval-event.entity.js';

export interface ApprovalActivityDeps {
  requestRepo: Repository<AccessRequestEntity>;
  eventRepo: Repository<ApprovalEventEntity>;
}

/**
 * Factory that returns activity implementations bound to NestJS repositories.
 * Called by TemporalWorkerService so activities can use TypeORM repos via closure.
 */
export function createApprovalActivities(deps: ApprovalActivityDeps) {
  return {
    /**
     * Record an escalation event and notify org admins.
     * Called when the first approval timeout elapses without a human decision.
     */
    async escalateApprovalRequest(requestId: string, orgId: string): Promise<void> {
      const request = await deps.requestRepo.findOne({ where: { id: requestId, orgId } });
      // Idempotent — if already resolved, do nothing.
      if (!request || request.status !== 'pending') return;

      const event = deps.eventRepo.create({
        orgId,
        requestId,
        action: 'escalated' as const,
        performedBy: null,
        note: 'Approval request escalated to org administrator — no decision within the initial approval window',
      });
      await deps.eventRepo.save(event);
    },

    /**
     * Transition the request to denied and record an expired event.
     * Called when the escalation timeout also elapses without a human decision.
     */
    async expireApprovalRequest(requestId: string, orgId: string): Promise<void> {
      const request = await deps.requestRepo.findOne({ where: { id: requestId, orgId } });
      // Idempotent — if already resolved (human acted just before expiry), do nothing.
      if (!request || request.status !== 'pending') return;

      request.status = 'denied';
      request.resolvedAt = new Date();
      request.resolutionNote =
        'Automatically expired — approval window elapsed with no decision';
      await deps.requestRepo.save(request);

      const event = deps.eventRepo.create({
        orgId,
        requestId,
        action: 'expired' as const,
        performedBy: null,
        note: 'Access request automatically expired after escalation timeout',
      });
      await deps.eventRepo.save(event);
    },
  };
}
