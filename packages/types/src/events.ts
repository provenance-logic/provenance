import type { Uuid, IsoTimestamp, SemanticVersion } from './common.js';
import type { DataProduct } from './products.js';
import type { PolicyDomain } from './governance.js';
import type { HealthStatus } from './connectors.js';

// ---------------------------------------------------------------------------
// Product Lifecycle Events
// Published to the product.lifecycle Redpanda topic.
// Discriminated union on eventType + schemaVersion.
// ---------------------------------------------------------------------------

interface ProductLifecycleEventBase {
  eventId: Uuid;
  schemaVersion: '1.0';
  orgId: Uuid;
  productId: Uuid;
  productSlug: string;
  domainId: Uuid;
  actorPrincipalId: Uuid;
  occurredAt: IsoTimestamp;
}

export interface ProductPublishedEvent extends ProductLifecycleEventBase {
  eventType: 'product.published';
  version: SemanticVersion;
  changeDescription: string | null;
  /** Full product snapshot at the time of publication. Used by OpenSearch indexer. */
  snapshot: DataProduct;
}

export interface ProductDeprecatedEvent extends ProductLifecycleEventBase {
  eventType: 'product.deprecated';
  version: SemanticVersion;
  deprecationReason: string | null;
  /** Date after which the product will be decommissioned. NULL if not scheduled. */
  sunsetAt: IsoTimestamp | null;
  /** UUID of the product that supersedes this one, if any. */
  successorProductId: Uuid | null;
}

export interface ProductDecommissionedEvent extends ProductLifecycleEventBase {
  eventType: 'product.decommissioned';
  version: SemanticVersion;
  decommissionReason: string | null;
}

export type ProductLifecycleEvent =
  | ProductPublishedEvent
  | ProductDeprecatedEvent
  | ProductDecommissionedEvent;

// ---------------------------------------------------------------------------
// Governance Events
// Published to the governance.events Redpanda topic.
// ---------------------------------------------------------------------------

interface GovernanceEventBase {
  eventId: Uuid;
  schemaVersion: '1.0';
  orgId: Uuid;
  occurredAt: IsoTimestamp;
}

export interface GovernancePolicyPublishedEvent extends GovernanceEventBase {
  eventType: 'governance.policy_published';
  policyDomain: PolicyDomain;
  policyVersionId: Uuid;
  versionNumber: number;
  publishedBy: Uuid;
  affectedProductCount: number;
}

export type GovernanceEvent = GovernancePolicyPublishedEvent;

// ---------------------------------------------------------------------------
// Connector Health Events
// Published to the connector.health Redpanda topic.
// ---------------------------------------------------------------------------

export interface ConnectorHealthEventMessage {
  eventId: Uuid;
  schemaVersion: '1.0';
  eventType: 'connector.health_checked';
  orgId: Uuid;
  connectorId: Uuid;
  domainId: Uuid;
  status: HealthStatus;
  responseTimeMs: number | null;
  errorMessage: string | null;
  checkedAt: IsoTimestamp;
}
