import type { Uuid, IsoTimestamp, PaginatedList } from './common.js';
import type { ConnectionPackage } from './access.js';

// ---------------------------------------------------------------------------
// Connection references — Domain 12 (F12.1 through F12.6 and forward)
//
// A connection reference is a first-class, owned, revocable record pairing
// an agent's access to a product with an explicit human-consented
// use-case declaration. It composes with, but does not replace, access
// grants (see ADR-005). Both an active access grant AND an active
// connection reference are required for any agent action against any
// product.
// ---------------------------------------------------------------------------

/**
 * Lifecycle states per F12.2.
 * Expired and Revoked are terminal — no transition out of either is permitted.
 */
export type ConnectionReferenceState =
  | 'pending'
  | 'active'
  | 'suspended'
  | 'expired'
  | 'revoked';

/**
 * Cause markers for state transitions (ADR-007 event payload field).
 * Preserved on the reference row as the most recent transition cause,
 * and emitted verbatim on the Redpanda event.
 */
export type ConnectionReferenceCause =
  | 'principal_action'
  | 'governance_action'
  | 'automatic_expiration'
  | 'major_version_suspension'
  | 'grant_revocation_cascade'
  | 'product_lifecycle_cascade'
  | 'principal_lifecycle_cascade'
  /**
   * F12.25 legacy-compatibility reference auto-provisioned at Domain 12
   * enforcement activation. Non-renewable; on expiry the agent must
   * submit a proper request.
   */
  | 'legacy_migration';

/**
 * Scope of an agent's intended or approved consumption of a product.
 * The MVP shape (locked 2026-05-08, see Domain 12 implementation plan
 * Decision 1) names output ports only. Action-verb gating and field-
 * level narrowing are deliberate future work — write tools land in
 * Phase 6+, and category-level narrowing lives in
 * {@link DataCategoryConstraints}.
 *
 * `ports` is a list of port names (not UUIDs). F12.6 requires the
 * use-case declaration to be preserved verbatim and immutably, and
 * names are what the human approver saw at approval time. The wildcard
 * `'*'` means "all output ports of the product" and must be rendered
 * as "all ports" in approval UIs so the principal sees what they
 * consent to.
 */
export interface ConnectionReferenceScope {
  ports: string[];
}

/**
 * Optional restriction to specific data categories within a product
 * that carries fields of multiple sensitivity levels (F12.6). When
 * `allowed_categories` is absent the reference imposes no
 * category-level narrowing beyond the port list in
 * {@link ConnectionReferenceScope}.
 */
export interface DataCategoryConstraints {
  allowed_categories?: string[];
}

export interface ConnectionReference {
  id: Uuid;
  orgId: Uuid;
  agentId: Uuid;
  productId: Uuid;
  /** Set when the reference is activated; captures the version in effect at approval time (F12.15). */
  productVersionId: Uuid | null;
  accessGrantId: Uuid;
  owningPrincipalId: Uuid;

  state: ConnectionReferenceState;
  /** Cause of the most recent state transition. Null on creation. */
  causedBy: ConnectionReferenceCause | null;

  requestedAt: IsoTimestamp;
  approvedAt: IsoTimestamp | null;
  activatedAt: IsoTimestamp | null;
  suspendedAt: IsoTimestamp | null;
  /** Explicit expiration is required per F12.4 — no indefinite references. */
  expiresAt: IsoTimestamp;
  terminatedAt: IsoTimestamp | null;

  approvedByPrincipalId: Uuid | null;
  /** Governance policy version in effect at approval time (F12.11). */
  governancePolicyVersion: string | null;

  useCaseCategory: string;
  purposeElaboration: string;
  intendedScope: ConnectionReferenceScope;
  dataCategoryConstraints: DataCategoryConstraints | null;
  requestedDurationDays: number;

  approvedScope: ConnectionReferenceScope | null;
  approvedDataCategoryConstraints: DataCategoryConstraints | null;
  approvedDurationDays: number | null;
  /** True if the approver narrowed scope vs. the original request (F12.7). */
  modifiedByApprover: boolean;

  denialReason: string | null;
  deniedByPrincipalId: Uuid | null;

  /**
   * Connection package generated at activation (ADR-008, F12.13).
   * Null until the reference transitions to `active`. Retained as an
   * immutable audit artifact after the reference terminates — consumers
   * check `state` to decide whether the package is usable.
   */
  connectionPackage: ConnectionPackage | null;

  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export type ConnectionReferenceList = PaginatedList<ConnectionReference>;

/**
 * Outbox row emitted by every state transition (ADR-007).
 * Published to the Redpanda topic `connection_reference.state` by a
 * separate worker; rows are retained 7 days after publish for replay.
 */
export interface ConnectionReferenceOutboxEntry {
  id: string;
  orgId: Uuid;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: IsoTimestamp;
  publishedAt: IsoTimestamp | null;
}

/**
 * Payload submitted by the requesting agent or human proxy when
 * opening a new connection reference request (F12.5, F12.6, F12.9).
 */
export interface SubmitConnectionReferenceRequest {
  agentId: Uuid;
  productId: Uuid;
  useCaseCategory: string;
  purposeElaboration: string;
  intendedScope: ConnectionReferenceScope;
  dataCategoryConstraints?: DataCategoryConstraints;
  requestedDurationDays: number;
}

/**
 * Minimum allowed length of the purpose elaboration free-text field.
 * Governance-configurable per F12.6 — this is the platform default.
 */
export const DEFAULT_PURPOSE_ELABORATION_MIN_LENGTH = 50;

/**
 * Optional narrowing of the originally-requested declaration when the
 * owning principal approves (F12.7 — modifications are attributed and
 * preserved alongside the original request). Any field left undefined
 * inherits the matching value from the original request.
 */
export interface ApproveConnectionReferenceOptions {
  approvedScope?: ConnectionReferenceScope;
  approvedDataCategoryConstraints?: DataCategoryConstraints;
  approvedDurationDays?: number;
  governancePolicyVersion?: string;
}

/**
 * Payload submitted when the owning principal denies a pending
 * connection reference request (F12.12). The reason is immutable and
 * required.
 */
export interface DenyConnectionReferenceRequest {
  reason: string;
}

/**
 * Payload submitted when the owning principal revokes an active or
 * suspended connection reference (F12.19). The reason is required and
 * recorded in the audit log. Revocation is immediate and terminal —
 * the reference cannot be reactivated.
 */
export interface RevokeConnectionReferenceRequest {
  reason: string;
}
