# ADR-005: Connection Reference as a Composition Primitive

**Date:** April 21, 2026
**Status:** Proposed
**Author:** Provenance Platform Team

---

## Context

Domain 12 (Connection References and Per-Use-Case Consent) introduces a new authorization primitive to the platform. The requirements specify that a connection reference:

- Pairs an agent's access to a product with an explicit, human-consented declaration of use case
- Is a first-class, owned, revocable entity
- Must be in an active state for an agent action to be authorized, in addition to an active access grant

This raises a foundational design question: should the connection reference replace the existing access grant model, extend it, or compose with it as a distinct concept?

The existing access grant model, established in Phase 2 and extended in Phase 5, captures:

- Whether an agent or human consumer is authorized to consume a product at all
- The scope of that authorization (which ports, rate limits)
- The expiration of that authorization
- The approval workflow that created it

It does not capture:

- Why the agent requested access
- What specific use case the consumer was approved for
- Whether subsequent behavior has remained within that original purpose
- A mechanism for the owning principal to distinguish between the initial "may this agent ever access this product" decision and ongoing per-use-case consent

The requirements in Domain 12 are explicit that both models must coexist. F12.1 states that "both must exist and be in an active state for an agent action to be authorized." The architectural decision is how to model the composition.

---

## Decision

Treat the connection reference as a distinct authorization primitive that composes with, but does not extend or replace, the access grant. The access grant answers *may this agent access this product at all*. The connection reference answers *for what declared purpose and within what scope is access authorized at this moment*.

### Composition Model

The composition is an AND relationship evaluated at every agent action:

```
agent_action_authorized ==
  access_grant.exists AND
  access_grant.active AND
  access_grant.agent_id == action.agent_id AND
  access_grant.product_id == action.product_id AND
  connection_reference.exists AND
  connection_reference.active AND
  connection_reference.agent_id == action.agent_id AND
  connection_reference.product_id == action.product_id AND
  connection_reference.scope ⊇ action.scope AND
  agent.trust_classification permits action.type
```

Failure of any conjunct denies the action. The denial reason is recorded distinctly so operators can distinguish "no grant" from "no active consent for this use case" from "scope violation" from "trust classification restriction."

### Lifecycle Independence

The two primitives have independent lifecycles and independent ownership:

| Property | Access Grant | Connection Reference |
| --- | --- | --- |
| Creation trigger | Access request submitted by consumer or agent | Connection reference request submitted with use-case declaration |
| Owning principal | Data Product Owner (the grant authority) | Data Product Owner (the consent authority for that use case) |
| Lifetime | Typically longer (product-level access horizon) | Typically shorter, bounded by classification-based maximums (F12.4) |
| Expiration behavior | Terminates access entirely | Terminates consent for one use case; other active references for the same agent-product pair remain valid |
| Revocation effect | Cascades: all connection references for the agent-product pair auto-revoke (F12.21) | Does not affect the underlying access grant |
| Renewal | Grant renewal extends the access horizon | A new connection reference is requested for a new or continuing use case |

The cascade in one direction only — access grant revocation revokes all connection references, but connection reference revocation does not touch the access grant — reflects the conceptual ordering. The grant is the prerequisite; the consent is the specific authorization within it.

### One Grant, Many References

A single access grant may have many connection references over time. Expected patterns:

- A new use case arises; the agent requests a new connection reference under the existing grant
- A connection reference expires; the agent requests a new one with the same use case
- Two concurrent use cases against the same product; two concurrent connection references
- A scope modification need; the existing reference is left to expire or is revoked, a new one is requested with the broader scope

A single connection reference never spans multiple access grants. If the grant is revoked and later re-issued, any connection references against the revoked grant remain in their terminal state (Revoked) and are not automatically reattached to the new grant.

### Why Not a Single Model

Collapsing the two primitives into one model was considered and rejected (see Alternatives). The short reason: the consent decision and the grant decision answer different governance questions at different cadences with different review criteria, and conflating them makes it impossible to answer either question cleanly from the audit log.

---

## Consequences

### Positive

- **Audit trail answers both questions independently.** "Who authorized this agent to ever touch this product" and "Who consented to this specific use case on this specific day" are answerable from distinct immutable records, as required by F12.7 and F6.11.
- **Existing access grant code path is unchanged.** The access module, access_grants table, access request approval flow, and all Phase 2 governance work continue to function without modification. Domain 12 is additive.
- **The governance override model composes naturally.** Governance may set policy that certain product classifications require governance sign-off at the connection reference activation step (F12.14) without affecting the grant approval path. These are two distinct policy evaluation points.
- **Ownership is consistent with the existing principal model.** The Data Product Owner is the authority for both grant approvals and consent approvals. There is no new role type, no new approval chain, no new delegation model.
- **Expiration semantics match the governance intent.** Bounded-duration connection references with classification-based maximums (F12.4) enforce the requirement that consent for a specific use case is inherently time-bounded, while the underlying grant can persist longer if appropriate.
- **The mental model is defensible to governance teams.** "An agent can access this product in general, and separately, is consented for these specific use cases right now" matches how human governance teams already reason about access in other domains (data processing agreements, purpose-limited consent in privacy law).

### Negative

- **Two enforcement checks on the agent action hot path instead of one.** Both must succeed for every tool call. This is mitigated by caching both in the same in-memory map in the Agent Query Layer (see ADR-006) and satisfies NF12.2.
- **Two request flows the agent must navigate.** An agent wanting to consume a product it has never consumed before must first submit an access request, then submit a connection reference request. The UI and MCP tool layer must guide this (F12.8 — agent discovery surfaces the current state of both).
- **Revocation semantics require care.** Revoking a grant should revoke all references; revoking a reference should not revoke the grant. The asymmetry is captured in F12.21 but must be enforced correctly in code. Runtime tests in the acceptance criteria cover this (AC12.4).
- **Two records to reason about in governance reporting.** Governance dashboards and compliance reports must surface both grant state and reference state. Mitigated by Domain 11 notification categories that are distinct for each primitive.

### Risks

- **Drift between the two models as the platform evolves.** If future features add fields to the access grant that conceptually belong in the connection reference or vice versa, the boundary could blur. Mitigated by ADR-005 itself documenting the conceptual separation so future decisions can reference it.
- **Agents or proxies assuming a single approval covers both.** Early users may be surprised that access grant approval does not imply immediate connection reference activation. Mitigated by F12.8 (discovery flow makes the dual state visible) and by notification copy that distinguishes the two.
- **Migration path for pre-Domain 12 agents.** Existing agents with active access grants will have no connection reference. They will be denied on the first action after Domain 12 enforcement goes live unless a migration is run. Migration approach is left to Claude Code and documented at implementation time; a one-time provisioning of a default "legacy compatibility" connection reference with a short expiration would allow existing agents to continue operating while their operators submit proper reference requests.

---

## Alternatives Considered

### 1. Extend the access grant to carry a use-case declaration

Add use_case, purpose_elaboration, approved_scope, and expires_at fields to the existing access_grants table. A new grant is required for each use case.

**Rejected because:** conflates two decisions at different cadences. An access grant review asks "should this agent ever access this product," typically answered infrequently. A consent review asks "should this agent access this product for this specific purpose right now," typically answered more often and with narrower authority. Collapsing them means either grant reviews happen at consent cadence (expensive, fatiguing) or consent decisions inherit the longer horizon of grant decisions (violates F12.4 duration maximums). Also breaks the one-grant-many-consents pattern that the Dataverse connection reference model depends on — under this alternative, a new use case would require revoking and re-creating the grant, losing the grant's history.

### 2. Replace the access grant with a connection reference

Deprecate access_grants entirely and migrate all authorization to connection references with a default "initial use" consent at grant creation time.

**Rejected because:** the platform has six domains of code and thousands of existing records that depend on access_grants as the authorization primitive. The compliance monitor, trust score computation, access request notifications, access expiration workflows, and frontend access status views all read from access_grants. Replacing them would be a Phase 6 scope migration with no corresponding customer-visible benefit. It would also lose the conceptual distinction between "may you ever" and "for this specific purpose now," which the governance teams consulted during requirements gathering consider meaningful.

### 3. Keep access grants and add a scope field for use-case constraints

Extend access_grants with a nullable use_case_scope field populated only for agents. Agents are denied if action scope exceeds the grant's use_case_scope.

**Rejected because:** a nullable field used only for agents creates a bifurcated model that is not visibly a first-class primitive. Governance teams cannot see "all current consents for product X" as a coherent list. Revocation of a use case requires revoking the grant. Expiration of a use case requires expiring the grant. The one-grant-many-consents relationship is impossible. This pattern would deliver worse ergonomics than the current per-product grant model while claiming to add consent semantics.

### 4. Store consent as policy in OPA rather than as data in PostgreSQL

Model each consent as a Rego policy rule and rely on OPA for evaluation. The connection reference is effectively a policy that exists while active.

**Rejected because:** OPA policies are authored by governance teams and represent general rules. Per-agent per-use-case consents are data, not policy. Treating them as policy creates a policy store that grows unboundedly with the number of active consents, defeats OPA's bundle model, and makes the audit trail for a specific consent decision harder to reconstruct. Policies evaluate behavior; data represents specific authorization instances.

---

## References

- PRD Domain 12: `documents/prd/Provenance_PRD_v1.4.md` (F12.1 - F12.24, NF12.1 - NF12.8, AC12.1 - AC12.9)
- Microsoft Dataverse connection references: https://learn.microsoft.com/en-us/power-apps/maker/data-platform/create-connection-reference
- PRD F6.7 (existing access grant model)
- ADR-002 (JWT agent authentication, the identity primitive this composes with)
- ADR-006 (runtime enforcement of the composed model)
- ADR-007 (state propagation for the composed model)
- ADR-008 (relationship to connection packages)
