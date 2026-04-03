/**
 * Temporal approval workflow.
 *
 * This file is isolated — only @temporalio/workflow imports are allowed.
 * All DB operations happen in activities (approval.activities.ts).
 *
 * Flow:
 *   1. Wait for human decision (resolveSignal) or first timeout.
 *   2. On first timeout → run escalateApprovalRequest activity.
 *   3. Wait for human decision or escalation timeout.
 *   4. On second timeout → run expireApprovalRequest activity (auto-deny).
 *   5. On resolveSignal at any phase → return immediately (DB already updated by API).
 */
import {
  defineSignal,
  setHandler,
  condition,
  proxyActivities,
} from '@temporalio/workflow';

export interface ApprovalWorkflowParams {
  requestId: string;
  orgId: string;
  /** Duration before first escalation, in milliseconds. */
  firstTimeoutMs: number;
  /** Duration before auto-expiry after escalation, in milliseconds. */
  escalationTimeoutMs: number;
}

/** Sent by the API when a human approves, denies, or withdraws the request. */
export const resolveSignal = defineSignal('resolve');

const { escalateApprovalRequest, expireApprovalRequest } = proxyActivities<{
  escalateApprovalRequest(requestId: string, orgId: string): Promise<void>;
  expireApprovalRequest(requestId: string, orgId: string): Promise<void>;
}>({
  startToCloseTimeout: '30s',
  retry: { maximumAttempts: 3 },
});

export async function approvalWorkflow(params: ApprovalWorkflowParams): Promise<void> {
  let resolved = false;
  setHandler(resolveSignal, () => {
    resolved = true;
  });

  // Phase 1: wait for human decision or first timeout
  const decidedInPhase1 = await condition(() => resolved, params.firstTimeoutMs);
  if (decidedInPhase1) return;

  // First timeout elapsed — escalate to org_admin
  await escalateApprovalRequest(params.requestId, params.orgId);

  // Phase 2: wait for human decision or escalation timeout
  const decidedInPhase2 = await condition(() => resolved, params.escalationTimeoutMs);
  if (decidedInPhase2) return;

  // Escalation timeout elapsed — auto-expire (auto-deny)
  await expireApprovalRequest(params.requestId, params.orgId);
}
