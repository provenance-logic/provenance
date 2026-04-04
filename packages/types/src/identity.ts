import type { Uuid, IsoTimestamp } from './common.js';
import type { PrincipalType, RoleType } from './organizations.js';

// ---------------------------------------------------------------------------
// Principal — platform-level identity record.
// Keycloak is the authentication source; this is the platform metadata layer.
// ---------------------------------------------------------------------------

export interface Principal {
  id: Uuid;
  orgId: Uuid;
  principalType: PrincipalType;
  keycloakSubject: string;
  email: string | null;
  displayName: string | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// JWT claims carried on every request.
// Validated by the Keycloak JWT guard in the NestJS API.
// ---------------------------------------------------------------------------

export interface JwtClaims {
  sub: string;
  email?: string;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
  /** Provenance-specific claims injected by the Keycloak mapper */
  provenance_principal_id?: Uuid;
  provenance_org_id?: Uuid;
  provenance_principal_type?: PrincipalType;
  /** Present only for AI agent tokens */
  agent_id?: Uuid;
  iat: number;
  exp: number;
}

// ---------------------------------------------------------------------------
// Request context — populated by the auth guard and attached to every request.
// ---------------------------------------------------------------------------

export interface RequestContext {
  principalId: Uuid;
  orgId: Uuid;
  principalType: PrincipalType;
  roles: RoleType[];
  /** Present only when principalType is ai_agent */
  agentId?: Uuid;
  /** Raw Keycloak subject (sub claim). Always the original Keycloak UUID. */
  keycloakSubject: string;
  /** From JWT email claim — used for first-login principal creation. */
  email?: string;
  /** From JWT name claims — used for first-login principal creation. */
  displayName?: string;
}

// ---------------------------------------------------------------------------
// Agent identity (Phase 4 — declared here for type completeness)
// ---------------------------------------------------------------------------

export type AgentTrustClassification = 'observed' | 'supervised' | 'autonomous';

export interface AgentIdentity {
  id: Uuid;
  orgId: Uuid;
  principalId: Uuid;
  displayName: string;
  modelId: string;
  modelVersion: string | null;
  trustClassification: AgentTrustClassification;
  humanOversightContactId: Uuid | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}
