# ADR-002: JWT-Based Agent Authentication via Keycloak Client Credentials

**Date:** April 15, 2026
**Status:** Accepted
**Author:** Provenance Platform Team
**Supersedes:** ADR-001 (MVP Agent Authentication via X-Agent-Id Header)

---

## Context

ADR-001 established the MVP agent authentication pattern: agent identity supplied
as a self-reported `agent_id` argument inside MCP tool calls, with no cryptographic
verification at the request level. This was accepted for Phase 4 because the agent
population was small and known, and building full JWT auth would have delayed the
Data 3.0 milestone.

Phase 5 closes this gap. Two specific problems need to be resolved:

1. **No request-level authentication.** The `/mcp/sse` and `/mcp/messages` endpoints
   accept connections from any caller. There is no mechanism to reject unauthenticated
   requests before they reach tool dispatch.

2. **Self-reported identity inside tool arguments.** Any caller can supply any
   `agent_id` value in tool arguments. Trust classification enforcement and audit
   log integrity both depend on the caller correctly identifying itself. This is
   not acceptable beyond a controlled MVP population.

Additionally, the current implementation diverges from ADR-001's described header
pattern: `agent_id` is passed as a tool argument, not an `X-Agent-Id` header.
ADR-002 supersedes both the documented and implemented MVP patterns.

---

## Decision

Implement JWT-based agent authentication using Keycloak's OAuth2
`client_credentials` grant flow.

### How it works

**Agent registration provisioning:**
When an agent is registered via the `register_agent` MCP tool (or the control
plane API directly), the platform provisions a dedicated Keycloak client for that
agent with:
- `client_id`: the agent's UUID
- `client_secret`: a generated secret returned once at registration time
- Grant type: `client_credentials`
- Custom claims: `principal_type=agent`, `agent_id=<uuid>`, `org_id=<uuid>`

The `register_agent` response adds two new fields:
- `keycloak_client_id`: the agent's UUID (same as `agent_id`)
- `keycloak_client_secret`: the generated secret (returned once, never stored)

**Token acquisition:**
The agent authenticates to Keycloak's token endpoint:

```
POST /realms/provenance/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=<agent_uuid>
&client_secret=<secret>
```

Keycloak returns a signed JWT with the standard OAuth2 response (`access_token`,
`expires_in`, `token_type`). The token contains custom claims injected by a
Keycloak protocol mapper configured during client provisioning:

```json
{
  "sub": "<agent_uuid>",
  "iss": "https://<keycloak>/realms/provenance",
  "aud": "provenance-api",
  "principal_type": "ai_agent",
  "agent_id": "<agent_uuid>",
  "provenance_org_id": "<org_uuid>",
  "exp": 1713225600,
  "iat": 1713225300
}
```

Token lifetime: **300 seconds** (5 minutes), matching the existing Keycloak realm
configuration in `provenance-realm.json`. Agents must re-acquire tokens before
expiry. No refresh tokens are issued for `client_credentials` grants.

**Request authentication:**
The agent includes the JWT as a Bearer token on every MCP request:

```
GET /mcp/sse
Authorization: Bearer <jwt>

POST /mcp/messages?sessionId=<sid>
Authorization: Bearer <jwt>
```

**Token validation at the Agent Query Layer:**
The Agent Query Layer (`apps/agent-query`, port 3002) validates every incoming
request before establishing an SSE session or processing a message:

1. Extract `Authorization: Bearer <token>` from the request header
2. Validate JWT signature against Keycloak's JWKS endpoint (RS256, cached keys)
3. Validate standard claims: `iss`, `aud`, `exp`
4. Extract custom claims: `agent_id`, `principal_type`, `provenance_org_id`
5. Verify `principal_type == "ai_agent"`
6. Attach extracted identity to the MCP session context

Rejected requests receive `401 Unauthorized` with no body. The Agent Query Layer
never falls through to tool dispatch on authentication failure.

**Identity propagation to the control plane:**
When the Agent Query Layer calls the control plane API on behalf of an authenticated
agent, it forwards the agent's identity:

- `Authorization: Bearer <MCP_API_KEY>` (service-to-service auth, unchanged)
- `X-Agent-Id: <agent_uuid>` (new header, extracted from validated JWT)
- `X-Org-Id: <org_uuid>` (new header, extracted from validated JWT)

The control plane trusts these headers only from the Agent Query Layer (validated
by MCP_API_KEY). The `agent_id` is no longer accepted as a tool argument for
identity purposes.

**Audit trail integrity:**
Because `agent_id` is extracted from a cryptographically signed JWT rather than
self-reported in tool arguments:
- Audit log entries in `audit.audit_log` are bound to verified agent identity
- Trust classification lookups use the verified `agent_id`
- The `human_oversight_contact` chain is anchored to a verified registration

### What changes

| Component | Before (Phase 4) | After (Phase 5) |
|---|---|---|
| MCP endpoint auth | None (open endpoints) | JWT Bearer token required |
| Agent identity source | `agent_id` tool argument | `agent_id` JWT claim |
| Agent Query Layer auth | None | JWT validation (JWKS, RS256) |
| Control plane forwarding | MCP_API_KEY only | MCP_API_KEY + X-Agent-Id + X-Org-Id headers |
| Agent registration response | agent_id, classification | + keycloak_client_id, keycloak_client_secret |
| Keycloak provisioning | None | Dedicated client per agent via Admin API |
| `register_agent` MCP tool | Creates DB record only | Creates DB record + Keycloak client |
| `agent_id` in tool args | Used for identity | Ignored for identity (backward-compat period), then removed |
| Token lifetime | N/A | 300s, no refresh token |

### What does not change

- **Human user authentication** remains Keycloak PKCE via `provenance-web` client.
- **Control plane JWT strategy** (`apps/api/src/auth/jwt.strategy.ts`) already
  validates Keycloak JWTs and extracts `agent_id` claims. No changes needed.
- **MCP_API_KEY** remains for service-to-service auth between Agent Query Layer
  and control plane. It is not replaced by agent JWTs.
- **Trust classification model** and governance-controlled promotion rules are
  unchanged.
- **SSE transport** for MCP remains unchanged. Auth is applied at the HTTP layer
  before SSE session establishment.
- **RLS policies** on PostgreSQL continue to enforce `org_id` isolation. The
  `org_id` now comes from a verified JWT claim instead of the MCP_API_KEY
  service account context.

---

## Implementation Plan

### Phase 5a: Keycloak client provisioning

1. **Keycloak Admin API integration.** New `KeycloakAdminService` in
   `apps/api/src/auth/` that provisions and manages Keycloak clients via the
   Admin REST API. Uses a dedicated service account
   (`provenance-agent-provisioner`) with `manage-clients` realm role.

2. **Protocol mapper template.** A hardcoded protocol mapper configuration
   applied to every agent client at creation time. Injects `principal_type`,
   `agent_id`, and `provenance_org_id` as token claims.

3. **Update `register_agent` flow.** After creating the `agent_identities` DB
   record, call `KeycloakAdminService.createAgentClient()`. Return the
   `keycloak_client_id` and `keycloak_client_secret` in the response. If
   Keycloak provisioning fails, roll back the DB record (transactional).

4. **Secret rotation endpoint.** New `POST /agents/{agentId}/rotate-secret`
   endpoint that generates a new Keycloak client secret and returns it once.
   Requires `governance_member` role or the agent's `human_oversight_contact`.

### Phase 5b: Agent Query Layer JWT validation

5. **JWT auth guard for MCP endpoints.** New NestJS guard in
   `apps/agent-query/src/auth/` that validates Bearer tokens on `/mcp/sse` and
   `/mcp/messages`. Uses `jwks-rsa` library with Keycloak JWKS endpoint and
   key caching (TTL: 1 hour).

6. **MCP session identity binding.** After JWT validation, bind the verified
   `agent_id` and `org_id` to the SSE session. All tool calls within that
   session inherit the verified identity. Remove `agent_id` from tool argument
   schemas.

7. **Identity forwarding headers.** Update `ControlPlaneClient` in
   `apps/agent-query/src/control-plane/control-plane.client.ts` to include
   `X-Agent-Id` and `X-Org-Id` headers on all requests, sourced from the
   session's verified identity.

8. **Control plane header extraction.** Update `JwtAuthGuard` in
   `apps/api/src/auth/jwt-auth.guard.ts` to extract `X-Agent-Id` and
   `X-Org-Id` from requests authenticated via MCP_API_KEY, and populate the
   `RequestContext` with verified agent identity.

### Phase 5c: Backward compatibility and migration

9. **Deprecation period.** For 30 days after deployment, the Agent Query Layer
   accepts both:
   - Authenticated requests (JWT Bearer token) — identity from JWT
   - Unauthenticated requests — falls back to `agent_id` tool argument (logged
     as deprecated, emits warning metric)

10. **Agent re-registration.** Existing agents without Keycloak clients need
    credentials. Provide a one-time migration endpoint
    `POST /agents/{agentId}/provision-credentials` that creates the Keycloak
    client for an existing agent record. Requires `governance_member` role.

11. **Cutover.** After the deprecation period, remove unauthenticated fallback.
    All MCP requests require a valid JWT. Remove `agent_id` from tool argument
    schemas entirely.

### Database migration

12. **V14 migration.** Add `keycloak_client_provisioned` (boolean, default false)
    column to `identity.agent_identities`. No secret storage — secrets exist only
    in Keycloak and are returned once at provisioning time.

---

## Consequences

### Positive

- **Request-level authentication.** Unauthenticated callers are rejected before
  reaching tool dispatch. The attack surface of the MCP endpoints is
  significantly reduced.

- **Verified agent identity.** The `agent_id` in audit logs, trust classification
  lookups, and access control decisions comes from a cryptographically signed
  token, not a self-reported argument. Identity spoofing requires compromising
  the agent's Keycloak client secret.

- **Unified identity model.** Human users and agents both authenticate via
  Keycloak JWTs with the same claim structure (`principal_type`,
  `provenance_org_id`). The existing `JwtStrategy` in the control plane handles
  both without branching.

- **Standard OAuth2 flow.** `client_credentials` is a well-understood OAuth2
  grant type. Agent developers integrate using standard OAuth2 libraries, not
  platform-specific authentication mechanisms.

- **Secret rotation without re-registration.** Agent credentials can be rotated
  via the Keycloak Admin API without disrupting the agent's identity record,
  trust classification history, or audit trail.

- **Kong gateway integration path.** Kong's JWT plugin can validate agent tokens
  at the gateway level in production, offloading validation from the application
  layer entirely.

### Negative

- **Keycloak becomes a hard dependency for agent operations.** If Keycloak is
  unavailable, agents cannot acquire tokens and all MCP operations fail. This is
  mitigated by Keycloak's HA deployment in production (Phase 5 scope) and by
  JWKS key caching in the Agent Query Layer (validation continues for cached key
  TTL even during brief Keycloak outages).

- **One Keycloak client per agent.** At scale (thousands of agents), this creates
  a large number of Keycloak clients. Keycloak handles this adequately for the
  expected agent population (hundreds per org), but may need monitoring. An
  alternative (shared client with agent-specific scopes) was rejected because it
  prevents per-agent secret rotation and complicates revocation.

- **Secret management burden on agent operators.** Agent operators must securely
  store the `client_secret` returned at registration and implement token
  refresh logic. This is standard OAuth2 practice but adds integration
  complexity compared to the zero-auth MVP pattern.

- **30-day migration window.** During the deprecation period, both authenticated
  and unauthenticated requests are accepted, temporarily maintaining the
  security gap for agents that have not yet migrated. This is bounded and
  monitored.

### Risks

- **Keycloak Admin API availability during registration.** Agent registration
  becomes a two-phase operation (DB + Keycloak). If Keycloak Admin API is
  unreachable, registration fails entirely. Mitigated by transactional rollback
  and clear error messaging.

- **Clock skew.** JWT `exp` validation is sensitive to clock differences between
  Keycloak and the Agent Query Layer. Mitigated by NTP synchronization across
  all infrastructure nodes (standard EC2/EKS practice) and a 30-second clock
  skew tolerance in token validation.

---

## Alternatives Considered

### 1. Mutual TLS (mTLS) per agent

Each agent would receive a client certificate at registration. Authentication
happens at the transport layer.

**Rejected because:** Certificate lifecycle management (issuance, rotation,
revocation, CRL/OCSP) is significantly more complex than OAuth2 token management.
The platform would need to operate a CA or integrate with one. Agent developers
would need to handle certificate-based auth, which is less common in the AI agent
ecosystem than Bearer tokens. Does not align with the existing Keycloak identity
infrastructure.

### 2. Shared Keycloak client with agent-specific scopes

All agents share a single `provenance-agents` Keycloak client. Agent identity is
encoded in custom scopes or token claims via a lookup during the token exchange.

**Rejected because:** A single shared secret means compromising one agent
compromises all agents. Secret rotation requires re-distributing to every agent
simultaneously. Revoking a single agent requires a custom deny-list rather than
simply deleting the Keycloak client.

### 3. API key per agent (non-JWT)

Issue a random API key per agent at registration. Validate by database lookup on
every request.

**Rejected because:** Database lookup on every request adds latency to the MCP
hot path. No standard claim structure means the Agent Query Layer must maintain
its own identity resolution logic. No expiry semantics — a leaked key is valid
until manually revoked. Does not integrate with Kong's JWT plugin for gateway-level
validation.

### 4. Keep MCP_API_KEY with enhanced headers

Continue using the shared MCP_API_KEY but require agents to send signed identity
headers (e.g., HMAC-signed `X-Agent-Id`).

**Rejected because:** Reinvents JWT verification poorly. The signing key
distribution problem is equivalent to the `client_secret` distribution problem,
but without the benefits of standard OAuth2 tooling, Keycloak's admin UI, or
Kong plugin compatibility.

---

## References

- [Keycloak Client Credentials Grant](https://www.keycloak.org/docs/latest/securing_apps/#_client_credentials_grant)
- [OAuth 2.0 Client Credentials Grant (RFC 6749 Section 4.4)](https://datatracker.ietf.org/doc/html/rfc6749#section-4.4)
- [MCP Specification — Transport](https://spec.modelcontextprotocol.io/specification/basic/transports/)
- CLAUDE.md security rules: "All agent tokens carry `principal_type=agent` and `agent_id` claims validated on every request"
- Existing Keycloak realm: `infrastructure/docker/config/keycloak/realms/provenance-realm.json`
- Existing JWT strategy: `apps/api/src/auth/jwt.strategy.ts`
- Existing JWT claims type: `packages/types/src/identity.ts`
