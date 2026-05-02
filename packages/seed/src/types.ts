export interface SeedOrg {
  slug: string;
  name: string;
  description: string;
  contactEmail: string;
  domains: SeedDomain[];
}

export interface SeedDomain {
  slug: string;
  name: string;
  description: string;
  ownerEmail: string;
}

export type SeedUserRole = 'org_admin' | 'domain_owner' | 'consumer' | 'governance';

export interface SeedUser {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  orgSlug: string;
  roles: SeedUserRole[];
  domainSlugs?: string[];
}

export interface SeedAgent {
  agentSlug: string;
  displayName: string;
  orgSlug: string;
  description: string;
  trustClassification: 'observed' | 'supervised' | 'autonomous';
  oversightContactEmail: string;
}

export interface SeedPolicy {
  orgSlug: string;
  policyKey: string;
  title: string;
  description: string;
  regoModule: string;
  appliesTo: 'platform' | 'domain' | 'product';
}

export type PortInterfaceType =
  | 'sql_jdbc'
  | 'rest_api'
  | 'graphql'
  | 'streaming_topic'
  | 'file_object_export'
  | 'semantic_query';

export interface SeedPortContract {
  fields: SeedPortField[];
  connectionDetails: SeedConnectionDetails;
  howToUse?: string;
}

export interface SeedPortField {
  name: string;
  type: string;
  description: string;
  nullable?: boolean;
  pii?: boolean;
}

export interface SeedConnectionDetails {
  interfaceType: PortInterfaceType;
  endpoint: string;
  protocol: string;
  authMethod: 'keycloak_oidc' | 'api_key' | 'iam' | 'none';
  exampleClient: string;
}

export interface SeedPort {
  slug: string;
  type: 'input' | 'output' | 'discovery' | 'observability' | 'control';
  interfaceType: PortInterfaceType;
  description: string;
  contract: SeedPortContract;
}

export interface SeedProduct {
  slug: string;
  name: string;
  description: string;
  orgSlug: string;
  domainSlug: string;
  ownerEmail: string;
  tags: string[];
  lifecycleState: 'draft' | 'published';
  ports: SeedPort[];
  freshnessSla: string;
  refreshCadence: string;
}

export interface SeedLineageEdge {
  fromProductSlug: string;
  toProductSlug: string;
  edgeType: 'derives_from' | 'transforms' | 'consumes' | 'depends_on';
  description: string;
}

export type SeedSloType = 'freshness' | 'null_rate' | 'latency' | 'completeness' | 'custom';
export type SeedSloOperator = 'lt' | 'lte' | 'gt' | 'gte' | 'eq';

export interface SeedSlo {
  productSlug: string;
  name: string;
  description: string;
  sloType: SeedSloType;
  metricName: string;
  thresholdOperator: SeedSloOperator;
  thresholdValue: number;
  thresholdUnit?: string;
  evaluationWindowHours?: number;
}

export type SeedAccessRequestStatus = 'pending' | 'approved' | 'denied' | 'withdrawn';

export interface SeedAccessRequest {
  productSlug: string;
  requesterEmail: string;
  justification: string;
  status: SeedAccessRequestStatus;
  // Days from "now" the request was submitted. Used to populate
  // requested_at so SLA badges (F11.9 / F11.10) render meaningfully.
  submittedDaysAgo: number;
  // For resolved requests, days from "now" the resolution happened
  // (must be ≤ submittedDaysAgo). Resolver email + note are optional.
  resolvedDaysAgo?: number;
  resolverEmail?: string;
  resolutionNote?: string;
}

export interface SeedAccessGrant {
  productSlug: string;
  granteeEmail: string;
  grantedByEmail: string;
  // Days from "now" the grant was issued — populates granted_at.
  grantedDaysAgo: number;
  // Days from "now" the grant expires (positive = future). Omit for
  // open-ended grants.
  expiresInDays?: number;
}
