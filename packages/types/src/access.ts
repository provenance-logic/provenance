import type { Uuid, IsoTimestamp, PaginatedList } from './common.js';
import type { OutputPortInterfaceType } from './products.js';

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export type AccessRequestStatus = 'pending' | 'approved' | 'denied' | 'withdrawn';

export type ApprovalEventAction =
  | 'submitted'
  | 'approved'
  | 'denied'
  | 'withdrawn'
  | 'escalated'
  | 'expired';

// ---------------------------------------------------------------------------
// Access Scope
// ---------------------------------------------------------------------------

/** Optional restriction of access to specific ports or fields. null means full product access. */
export type AccessScope = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Access Grants
// ---------------------------------------------------------------------------

export interface AccessGrant {
  id: Uuid;
  orgId: Uuid;
  productId: Uuid;
  granteePrincipalId: Uuid;
  /** NULL for system-auto-approved grants. */
  grantedBy: Uuid | null;
  grantedAt: IsoTimestamp;
  /** NULL means indefinite access. */
  expiresAt: IsoTimestamp | null;
  revokedAt: IsoTimestamp | null;
  revokedBy: Uuid | null;
  /** NULL means full product access. */
  accessScope: AccessScope | null;
  /** Set when this grant was created via an approved access request. */
  approvalRequestId: Uuid | null;
  /** Ready-to-use connection artifact per F10.8. Generated at grant time. */
  connectionPackage: ConnectionPackage | null;
}

// ---------------------------------------------------------------------------
// Connection package (F10.8) — a per-port ready-to-use artifact returned to
// the consumer at grant time. One package per output port on the product;
// packageVersion lets refresh flows (F10.10) show when it was last updated.
// ---------------------------------------------------------------------------

export interface ConnectionPackagePort {
  portId: Uuid;
  portName: string;
  interfaceType: OutputPortInterfaceType;
  /**
   * Flexible bag of artifacts — shape depends on interfaceType. For example
   * SQL/JDBC ports carry `jdbcUrl`, `pythonSnippet`, `sampleQuery`, and
   * `dataDictionary`; REST ports carry `curlExample`, `postmanCollection`,
   * `pythonSnippet`, `endpointReference`.
   */
  artifacts: Record<string, unknown>;
}

export interface ConnectionPackage {
  packageVersion: number;
  generatedAt: IsoTimestamp;
  ports: ConnectionPackagePort[];
  /** Agent integration guide (F10.9) — present when any port is agent-accessible. */
  agentIntegration?: {
    mcpToolCalls: string[];
    examplePrompt: string;
    trustScore: number | null;
    governancePolicyVersion: string | null;
  };
}

export interface DirectGrantRequest {
  productId: Uuid;
  granteePrincipalId: Uuid;
  /** Optional expiration. Omit for indefinite access. */
  expiresAt?: IsoTimestamp;
  /** Optional scope restriction. Omit for full access. */
  accessScope?: AccessScope;
}

export interface RevokeGrantRequest {
  reason?: string;
}

export type AccessGrantList = PaginatedList<AccessGrant>;

// ---------------------------------------------------------------------------
// Access Requests
// ---------------------------------------------------------------------------

export interface AccessRequest {
  id: Uuid;
  orgId: Uuid;
  productId: Uuid;
  requesterPrincipalId: Uuid;
  justification: string | null;
  /** NULL means full access was requested. */
  accessScope: AccessScope | null;
  status: AccessRequestStatus;
  /** Temporal workflow ID tracking the approval. */
  temporalWorkflowId: string | null;
  requestedAt: IsoTimestamp;
  resolvedAt: IsoTimestamp | null;
  resolvedBy: Uuid | null;
  resolutionNote: string | null;
  updatedAt: IsoTimestamp;
}

export interface SubmitAccessRequestRequest {
  productId: Uuid;
  justification?: string;
  /** Requested scope restriction. Omit for full access. */
  accessScope?: AccessScope;
}

export interface ApproveAccessRequestRequest {
  /** Optional approval note recorded in the audit trail. */
  note?: string;
  /** Optional expiration for the resulting grant. Omit for indefinite access. */
  expiresAt?: IsoTimestamp;
}

export interface DenyAccessRequestRequest {
  note?: string;
}

export interface WithdrawAccessRequestRequest {
  note?: string;
}

/** Returned by the approve action — includes both the updated request and the new grant. */
export interface AccessRequestApprovalResult {
  request: AccessRequest;
  grant: AccessGrant;
}

export type AccessRequestList = PaginatedList<AccessRequest>;

// ---------------------------------------------------------------------------
// Approval Events (append-only audit trail)
// ---------------------------------------------------------------------------

export interface ApprovalEvent {
  id: Uuid;
  orgId: Uuid;
  requestId: Uuid;
  action: ApprovalEventAction;
  /** NULL for system-generated events (e.g. workflow timeout or expiry). */
  performedBy: Uuid | null;
  note: string | null;
  occurredAt: IsoTimestamp;
}

export type ApprovalEventList = PaginatedList<ApprovalEvent>;
