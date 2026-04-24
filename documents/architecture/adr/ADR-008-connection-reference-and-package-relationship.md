# ADR-008: Connection Reference and Connection Package Relationship

**Date:** April 21, 2026
**Status:** Accepted (2026-04-24 — V19 adds the per-reference `connection_package` column; activation generates and stores the package via `ConnectionPackageService`. Scope-narrowing of the package contents to the approved ports/fields is follow-up implementation work, not an architectural change.)
**Author:** Provenance Platform Team

---

## Resolves

PRD Domain 12 Architectural Open Question **AQ3** — How does the connection reference relate to the connection package issued in Domain 10?

---

## Context

Two concepts in the platform use the word "connection." They refer to different things and the distinction matters for implementation:

- **Connection reference** (Domain 12, new) — the authorization construct. An owned, revocable, use-case-scoped entity that represents a principal's explicit consent for an agent to consume a product for a declared purpose.
- **Connection package** (Domain 10, F10.8) — the usable artifact. A ready-to-use bundle containing the JDBC string, curl snippet, Kafka consumer config, MCP tool reference, or equivalent that a consumer or agent needs to actually reach the source system.

F12.13 requires that activation of a connection reference produces a connection package "scoped to the approved data category scope and port access of the connection reference." F10.10 requires that connection packages refresh when underlying connection details change.

This ADR decides the relationship between the two: whether a connection package is issued per connection reference, shared across references for the same agent-product pair, or issued once per access grant and filtered per reference.

The decision has implications for:

- How many connection packages are generated per agent over time
- What happens to a connection package when the reference is suspended, expired, or revoked
- How scope enforcement at the source system relates to scope enforcement at the platform
- What the agent developer sees when they receive a connection package

---

## Decision

A connection package is issued per connection reference. Each connection package is tied to exactly one connection reference, inherits its approved scope, and is invalidated when the reference is no longer active.

### Lifecycle Binding

The lifecycle of a connection package tracks its owning connection reference:

| Connection Reference State | Connection Package State |
| --- | --- |
| Pending | Not yet generated |
| Active | Generated and available to the agent |
| Suspended | Retained but marked unusable; agent cannot access new package content |
| Expired | Package is invalidated; retained as audit artifact, not served to the agent |
| Revoked | Package is invalidated; retained as audit artifact, not served to the agent |

Package invalidation is a logical state, not a deletion. The audit record of "this package was issued for this reference" is preserved indefinitely. The package's runtime usability is what is removed.

### Scope Inheritance

The connection package's contents reflect only the approved scope of the reference, not the full capability of the underlying product:

- If the reference approves access to output ports A and C but not B, the package contains connection artifacts for A and C only.
- If the reference approves specific data categories (F12.6), the package includes only the fields or schemas within those categories when the port type supports field-level filtering (e.g., SQL views exposing the approved columns).
- The use-case category from the reference is included as a comment or metadata annotation in the generated artifact so that the agent developer and any human reviewer can trace the artifact back to the consent decision.

This inheritance is one-way: the package is derived from the reference. The package does not carry its own scope definition, and changes to the package (e.g., connection detail updates under F10.10) never alter the reference's approved scope.

### Refresh Behavior

F10.10 requires regeneration of connection packages when underlying connection details change. Under this ADR, refresh behavior is:

- A connection detail change on a product triggers regeneration of all connection packages for that product that are tied to currently Active connection references.
- Packages tied to Suspended, Expired, or Revoked references are not regenerated — they are audit artifacts only.
- Regeneration preserves the scope of the original reference; the new package reflects the new connection details (new host, new credentials path) filtered through the original scope.
- The agent is notified of the regenerated package via the notification service (F11 extension covered by Domain 11's `connection_package_refreshed` category).

No re-consent is required on connection detail change — the use case has not changed, only the mechanics of reaching the source. This preserves the principle that consent is bound to purpose, not implementation.

### Provenance Envelope Integration

F12.18 requires every query result to include the connection reference identifier in its provenance envelope (F6.17). Under this ADR, the relationship is explicit:

- The connection package is generated with the connection reference identifier embedded as a metadata field.
- When the agent uses the package to execute a query, the query result's provenance envelope includes both the reference ID and the approved use-case category sourced from the reference.
- Auditors following a result back to its authorization can reconstruct the full chain: provenance envelope → reference ID → consent record → approving principal → declared use case.

### Relationship to the Access Grant

The access grant is the prerequisite; the connection reference is the per-use-case authorization; the connection package is the usable artifact. The access grant itself does not produce a connection package under Domain 12. Pre-Domain 12 agents with access grants but no connection reference see no connection package available; they must first request a connection reference.

For non-agent consumers (human consumers), connection packages continue to be generated per access grant per F10.8 as originally specified — Domain 12's connection reference model applies only to agent principals. Human consumers operate under a different consent model (manual access requests with explicit justification per F6.7) and are outside Domain 12's scope.

---

## Consequences

### Positive

- **Clear ownership and lifecycle.** Each package has exactly one owning reference. Questions like "why does this agent have access to these fields" trace cleanly through the reference to the consenting principal.
- **Scope enforcement is defense-in-depth.** Platform enforcement at the Agent Query Layer (ADR-006) prevents out-of-scope actions at the request boundary. The connection package narrows what the agent can physically attempt to access by only including the approved artifacts. Both layers must be bypassed for an out-of-scope action to succeed.
- **Revocation is meaningful.** Revoking a reference invalidates the package, not just the platform-side authorization. The agent cannot fall back to a previously issued artifact after revocation.
- **Audit is complete.** Every package is tied to a reference, which is tied to a consent decision, which is tied to an approving principal. The chain is never broken.
- **Refresh preserves the trust anchor.** Connection detail changes refresh the package without renewing consent, because the consent is for the use case, not the connection string. This matches the operational reality of credential rotation without creating consent fatigue.

### Negative

- **More connection packages generated over time.** If an agent holds a series of connection references against the same product (one expires, a new one is requested), each generates a package. Storage impact is minimal (packages are small) but governance dashboards must surface them appropriately.
- **Package generation happens more often than under the existing F10.8 model.** Each reference activation regenerates, where previously one package per access grant sufficed. At expected rates (tens of references per agent per year at most), this is still low volume.
- **Invalidated packages are retained as audit artifacts.** This means storage for packages that are no longer usable. Mitigated by packages being small (under 10 KB typical) and by retention policy matching the audit log retention.

### Risks

- **Agent developer confusion between "package" and "reference."** An agent developer might see their package disappear when the reference is suspended and not understand the distinction. Mitigated by the agent integration guide (F10.9) explaining the relationship and by error messages at the enforcement layer distinguishing failure modes (ADR-006).
- **Over-scoping at package generation time.** A lazy implementation could generate a package with the full product's connection details and rely only on platform enforcement for scope. This would undermine the defense-in-depth benefit. The implementation must actually filter the package contents per approved scope; a test should verify that a package for a port-B-excluded reference contains no port-B artifacts.

---

## Alternatives Considered

### 1. One connection package per (agent, product) pair, reused across references

A single connection package per agent-product pair. References filter what the agent is authorized to do with it at the platform layer, but the package artifact itself is identical regardless of reference.

**Rejected because:** this pushes all scope enforcement to the platform layer. If the agent can bypass platform enforcement (e.g., via a credential leak or a bug), the package grants them everything. The defense-in-depth benefit of filtering the package contents per approved scope is lost. Also breaks the audit chain — a package used for multiple purposes over time has no clean mapping back to a specific consent decision.

### 2. Connection package tied to access grant, not connection reference

Keep Domain 10's original per-grant model. Reference enforcement is entirely at the Agent Query Layer; the package is unchanged.

**Rejected because:** same defense-in-depth problem as alternative 1. Additionally, this decouples the agent's usable artifact from the consent decision entirely — revoking a reference would leave the agent with a still-usable package that only the platform enforcement prevents from being abused. If the platform layer is bypassed for any reason, the reference revocation is meaningless at the source.

### 3. No connection package for agents at all

Agents interact exclusively through the MCP tool layer, which does not require a connection package. Packages are for human consumers only.

**Rejected because:** F10.9 (agent integration guide) and the broader self-serve promise extend to agents. Agents may need non-MCP access to some output ports (SQL endpoints, REST APIs, streaming topics) depending on the use case. Restricting agents to MCP-only access narrows the platform's value proposition and conflicts with the first persona priority (AI Agents as first-class participants, CLAUDE.md).

### 4. Generate the package lazily on first use

The reference is activated but no package is generated until the agent first requests access to the product. Reduces storage and generation work for references that are approved but never used.

**Rejected because:** the NF12.1 budget (consent capture within 5 seconds of approval) includes making the authorization usable. A lazy approach means the first action takes the package-generation latency (F10.4 allows up to 10 seconds), which makes the first action noticeably slower than subsequent actions and creates a surprising latency spike. Eager generation at activation time amortizes the cost at the moment the owning principal expects activation latency anyway.

---

## References

- PRD Domain 12: F12.13 (activation behavior), F12.18 (provenance envelope integration)
- PRD Domain 10: F10.8 (connection package generation), F10.9 (agent integration guide), F10.10 (connection package refresh)
- PRD Domain 6: F6.17 (provenance envelope content)
- ADR-005 (connection reference composition primitive, the owning entity of the package)
- ADR-006 (runtime enforcement, the platform-layer defense that composes with package-layer filtering)
- ADR-007 (state propagation, the mechanism that drives package invalidation on reference state change)
