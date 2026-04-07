import type { Uuid, IsoTimestamp, PaginatedList } from './common.js';

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export type PolicyDomain =
  | 'product_schema'
  | 'classification_taxonomy'
  | 'versioning_deprecation'
  | 'access_control'
  | 'lineage'
  | 'slo'
  | 'agent_access'
  | 'interoperability';

export type PolicyScopeType = 'global_floor' | 'domain_extension';

export type ComplianceStateValue = 'compliant' | 'drift_detected' | 'grace_period' | 'non_compliant';

export type GracePeriodOutcome = 'pending' | 'compliant' | 'escalated';

// ---------------------------------------------------------------------------
// Policy Schema
// ---------------------------------------------------------------------------

export interface PolicySchema {
  id: Uuid;
  orgId: Uuid;
  policyDomain: PolicyDomain;
  schemaVersion: string;
  schemaDefinition: Record<string, unknown>;
  isPlatformDefault: boolean;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export type PolicySchemaList = PaginatedList<PolicySchema>;

// ---------------------------------------------------------------------------
// Policy Version (immutable artifact — DELETE revoked)
// ---------------------------------------------------------------------------

export interface PolicyVersion {
  id: Uuid;
  orgId: Uuid;
  policyDomain: PolicyDomain;
  versionNumber: number;
  rules: Record<string, unknown>;
  description: string | null;
  publishedBy: Uuid;
  publishedAt: IsoTimestamp;
  regoBundleRef: string | null;
}

export interface PublishPolicyRequest {
  policyDomain: PolicyDomain;
  rules: Record<string, unknown>;
  description?: string;
}

export type PolicyVersionList = PaginatedList<PolicyVersion>;

// ---------------------------------------------------------------------------
// Policy Impact Preview
// ---------------------------------------------------------------------------

export interface PolicyImpactPreviewRequest {
  policyDomain: PolicyDomain;
  rules: Record<string, unknown>;
}

export interface ImpactedProduct {
  productId: Uuid;
  productName: string;
  domainId: Uuid;
  currentState: ComplianceStateValue;
  projectedState: ComplianceStateValue;
  violations: ComplianceViolation[];
}

export interface PolicyImpactPreview {
  policyDomain: PolicyDomain;
  totalProducts: number;
  impactedProducts: ImpactedProduct[];
  newViolationCount: number;
  resolvedViolationCount: number;
}

// ---------------------------------------------------------------------------
// Effective Policy
// ---------------------------------------------------------------------------

export interface EffectivePolicy {
  id: Uuid;
  orgId: Uuid;
  policyDomain: PolicyDomain;
  scopeType: PolicyScopeType;
  scopeId: Uuid | null;
  policyVersionId: Uuid;
  computedRules: Record<string, unknown>;
  computedAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export type EffectivePolicyList = PaginatedList<EffectivePolicy>;

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

export interface ComplianceViolation {
  policyDomain: PolicyDomain;
  ruleId: string;
  detail: string;
}

export interface ComplianceState {
  id: Uuid;
  orgId: Uuid;
  productId: Uuid;
  state: ComplianceStateValue;
  violations: ComplianceViolation[];
  policyVersionId: Uuid | null;
  evaluatedAt: IsoTimestamp;
  nextEvaluationAt: IsoTimestamp | null;
  updatedAt: IsoTimestamp;
}

export interface TriggerEvaluationRequest {
  productId?: Uuid;
  domainId?: Uuid;
}

export interface EvaluationResult {
  evaluated: number;
  compliant: number;
  nonCompliant: number;
  driftDetected: number;
  gracePeriod: number;
  violations: ComplianceViolation[];
}

export type ComplianceStateList = PaginatedList<ComplianceState>;

// ---------------------------------------------------------------------------
// Exception
// ---------------------------------------------------------------------------

export interface Exception {
  id: Uuid;
  orgId: Uuid;
  productId: Uuid;
  policyDomain: PolicyDomain;
  policyVersionId: Uuid | null;
  exceptionReason: string;
  grantedBy: Uuid;
  grantedAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
  revokedAt: IsoTimestamp | null;
  revokedBy: Uuid | null;
  updatedAt: IsoTimestamp;
}

export interface GrantExceptionRequest {
  productId: Uuid;
  policyDomain: PolicyDomain;
  exceptionReason: string;
  expiresAt: IsoTimestamp;
  policyVersionId?: Uuid;
}

export type ExceptionList = PaginatedList<Exception>;

// ---------------------------------------------------------------------------
// Grace Period
// ---------------------------------------------------------------------------

export interface GracePeriod {
  id: Uuid;
  orgId: Uuid;
  productId: Uuid;
  policyDomain: PolicyDomain;
  policyVersionId: Uuid;
  endsAt: IsoTimestamp;
  temporalWorkflowId: string | null;
  startedAt: IsoTimestamp;
  endedAt: IsoTimestamp | null;
  outcome: GracePeriodOutcome;
  updatedAt: IsoTimestamp;
}

export type GracePeriodList = PaginatedList<GracePeriod>;

// ---------------------------------------------------------------------------
// Governance Dashboard (Command Center aggregate)
// ---------------------------------------------------------------------------

export interface GovernanceDashboardSummary {
  totalPublished: number;
  compliant: number;
  driftDetected: number;
  gracePeriod: number;
  nonCompliant: number;
}

export interface GovernanceDomainHealth {
  policyDomain: PolicyDomain;
  totalProducts: number;
  compliantCount: number;
  /** 'green' >= 90%, 'amber' >= 70%, 'red' < 70% */
  status: 'green' | 'amber' | 'red';
}

export interface GovernanceComplianceEvent {
  productId: Uuid;
  productName: string;
  domainName: string;
  previousState: ComplianceStateValue | null;
  newState: ComplianceStateValue;
  changedAt: IsoTimestamp;
}

export interface GovernanceDashboard {
  summary: GovernanceDashboardSummary;
  domainHealth: GovernanceDomainHealth[];
  recentEvents: GovernanceComplianceEvent[];
  activeExceptions: Exception[];
  activeGracePeriods: GracePeriod[];
}
