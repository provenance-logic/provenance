# ADR-001: MVP Agent Authentication via X-Agent-Id Header

**Date:** April 13, 2026
**Status:** Superseded
**Author:** Provenance Platform Team
**Superseded by:** ADR-002 (April 15, 2026): JWT-Based Agent Authentication via Keycloak Client Credentials — implemented April 16, 2026

---

## Context

The MCP server (agent-query service) requires a way to associate incoming tool calls with registered agent identities for two purposes:

1. **Audit logging** — every MCP tool call must be logged with agent identity context so that the audit trail is complete and the question "which agent made this call" is always answerable
2. **Trust classification enforcement** — the platform must know the calling agent's trust classification before permitting consequential actions (Supervised agents hold actions pending human approval; Autonomous agents execute immediately)

The ideal solution is cryptographically verified agent identity: each registered agent receives a signed JWT from Keycloak carrying `principal_type=agent` and `agent_id` claims, validated on every MCP request. This is the Phase 5 target state.

However, implementing full JWT-based agent authentication in Phase 4 would require:

- Keycloak agent client configuration (a client per registered agent, or a dedicated agent realm)
- Agent onboarding flows that provision Keycloak credentials and issue signed tokens
- Token refresh handling in MCP client implementations
- Integration between the agent registration API and Keycloak provisioning

These flows were not yet built when Phase 4 MCP development began. Building them in Phase 4 would have delayed the Data 3.0 milestone without delivering additional product capability visible to early users.

---

## Decision

Use an optional `X-Agent-Id` request header as the MVP agent identity signal.

**How it works:**
- MCP tool calls may carry an `X-Agent-Id` header containing a registered agent's UUID
- If present, the MCP server fetches agent details from the control plane and populates audit log entries with agent identity context and trust classification
- If absent, calls are logged as service account activity under the `MCP_API_KEY` credential
- The `MCP_API_KEY` bypass on the control plane API is the auth mechanism for all MCP → control plane calls
- No cryptographic verification of the agent identity claim occurs

**What this means for audit integrity:**
Agent identity in audit logs is self-reported in MVP — a caller could supply any `agent_id` value. This is a known and accepted limitation. It is acceptable for MVP because:

1. The agent population is small and known — early users are working directly with the platform team
2. The audit log still captures every call — the gap is identity verification, not completeness
3. Phase 5 closes this gap with cryptographically verified JWTs

**What this does not change:**
- Trust classification enforcement logic is correct — if an `X-Agent-Id` is supplied and the agent is Supervised, consequential actions are held pending approval as designed
- The audit trail is complete — all calls are logged regardless of whether an agent ID is supplied
- The agent registration and trust classification model is fully implemented — this decision affects only the authentication layer, not the identity model

---

## Consequences

**Accepted tradeoffs:**
- Agent identity in audit logs is self-reported and unverified in MVP
- A malicious or misconfigured caller could impersonate another registered agent by supplying its UUID in the header
- Trust classification enforcement relies on the caller correctly identifying itself

**Why this is acceptable:**
- MVP agent population is controlled and trusted
- The audit log remains complete — any impersonation would still be logged and visible
- The architecture cleanly isolates the auth concern in middleware — Phase 5 replacement requires changing middleware only, not business logic

**Phase 5 resolution:**
Phase 5 delivers full JWT-based agent authentication. Each registered agent receives a signed JWT from Keycloak carrying `principal_type=agent` and `agent_id` claims. The MCP server middleware validates the JWT signature on every request. The `X-Agent-Id` header pattern is retired. The agent onboarding flow provisions Keycloak credentials during agent registration.

The auth concern is intentionally isolated in the MCP server middleware layer. No business logic should depend on the `X-Agent-Id` header being the permanent mechanism — new features should be written assuming verified identity will be available.

---

## Implementation Notes

- The `X-Agent-Id` header is read in the MCP server request middleware before tool dispatch
- Agent details are fetched from the control plane via the internal API using `MCP_API_KEY`
- Agent identity context is attached to the request object and passed through to audit log writes
- If the supplied `agent_id` does not correspond to a registered agent, the call proceeds as service account activity (no error) to avoid revealing agent UUID enumeration information

---

*See `documents/architecture/Provenance_Architecture_v1.4.md` Section 3 (MVP Agent Authentication Pattern) for the architectural context.*
