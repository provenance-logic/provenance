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
// Per-principal preferences — F7.46 onboarding wizard initially, room
// for future preference shapes (UI layout, default filters, etc.).
// ---------------------------------------------------------------------------

/**
 * Onboarding-wizard progress (F7.46). The wizard reads this on every
 * dashboard load and decides whether to surface itself. Once
 * `completedAt` or `dismissedAt` is set the wizard never auto-opens
 * again, but the user can re-enter it from a "Restart onboarding"
 * link if we add one later.
 */
export interface OnboardingState {
  /** Step keys the user has marked complete. */
  completedSteps: string[];
  /** Step keys the user explicitly skipped (counts as "done" for the wizard). */
  skippedSteps: string[];
  /** Set when the user finishes or skips the last step. */
  completedAt: IsoTimestamp | null;
  /** Set when the user clicks "Dismiss for now" — wizard stops auto-opening but progress is retained. */
  dismissedAt: IsoTimestamp | null;
  /** Most recent step the user was on, so resume-on-next-login lands on the right panel. */
  lastStep: string | null;
}

export interface PrincipalPreferences {
  onboarding?: OnboardingState;
}

export interface PrincipalPreferencesResponse {
  preferences: PrincipalPreferences;
  updatedAt: IsoTimestamp;
}

/** Deep partial — `PATCH /me/preferences` accepts any subset and merges. */
export interface UpdatePrincipalPreferencesRequest {
  preferences: Partial<PrincipalPreferences>;
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
