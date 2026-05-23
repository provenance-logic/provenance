import { SetMetadata } from '@nestjs/common';

export const ALLOW_CROSS_ORG_WRITE_FOR_APPROVAL_KEY =
  'allowCrossOrgWriteForApproval';

/**
 * Marks a JWT-authenticated endpoint as an intentional cross-tenant
 * WRITE for marketplace approval flows. The `JwtAuthGuard` skips its
 * `request.params.orgId === request.user.orgId` check when this
 * decorator is present, the same way it does for `@AllowCrossOrgRead`.
 *
 * **Why a separate decorator from `@AllowCrossOrgRead`.** That decorator
 * is scoped to GET endpoints whose return shape is marketplace-public.
 * This decorator is for the narrow set of WRITE endpoints where an
 * owner in Org B mutates a request row that lives in Org A's namespace
 * (per anchor decision 3 / Model A — request and grant rows live in
 * the requester's org, the owner reaches across to approve / deny).
 * Splitting the decorators keeps the intent explicit at the call site
 * and makes the audit/review trail unambiguous: nothing labelled
 * `@AllowCrossOrgRead` is a write; nothing labelled
 * `@AllowCrossOrgWriteForApproval` is a generic write.
 *
 * Use ONLY for marketplace-approval endpoints — concretely, the
 * approve/deny endpoints on access requests today, and any future
 * approval-shaped action (e.g., connection-reference activation by an
 * owner against a cross-org consumer's request). Always paired with:
 *
 *   - `@Roles('org_admin', 'domain_owner')` at the controller — the
 *     decorator only relaxes the org-URL check; role enforcement and
 *     service-layer ownership validation still apply.
 *   - A service-layer ownership check that confirms the caller's org
 *     owns the *product* the request targets (e.g.,
 *     `assertCallerCanResolve` in AccessService). The decorator
 *     trusts no one without this second-layer check; the precedent
 *     pattern was set by B-059.
 *   - An audit log entry on the cross-org write itself (or on
 *     scope-violation attempts, per `assertCallerCanResolve`).
 *
 * Do NOT apply to:
 *   - Non-approval mutations (POST/PATCH/DELETE that aren't
 *     approve/deny shaped).
 *   - Endpoints that haven't been audited for cross-org write blast
 *     radius.
 *   - Anything where the caller's authority over the target resource
 *     isn't independently verifiable by the service layer.
 *
 * The caller still needs a valid Keycloak JWT (the decorator does NOT
 * bypass authentication) and still needs a non-empty
 * `provenance_org_id` claim (the decorator does NOT bypass
 * `@AllowNoOrg` enforcement).
 *
 * Resolves: B-071 (cross-org access requests structurally broken —
 * approve / deny half).
 * Pairs with: [[allow-cross-org-read-decorator]] for the read half
 * (B-068, marketplace-public reads).
 */
export const AllowCrossOrgWriteForApproval = () =>
  SetMetadata(ALLOW_CROSS_ORG_WRITE_FOR_APPROVAL_KEY, true);
