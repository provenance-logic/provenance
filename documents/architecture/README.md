# Architecture

This directory documents how Provenance is built — both the MVP shape running today and the production architecture the platform will grow into.

## Documents

| Document | Purpose |
| --- | --- |
| [`Provenance_Architecture_v1.5.md`](./Provenance_Architecture_v1.5.md) | **Architecture Document v1.5.** MVP and production architecture, technology decisions, build sequence, and the five non-negotiable architectural constraints. Aligned with PRD v1.5. |
| [`adr/`](./adr/) | **Architecture Decision Records.** Numbered, dated, and irreversible decisions captured at the point they were made. See the index below. |
| [`plans/`](./plans/) | **Implementation plans.** Pre-coding design docs for multi-PR arcs, locked decisions, and rationale. Currently holds the Domain 12 runtime-enforcement plan. |

## Architecture Decision Records

| ID | Title |
| --- | --- |
| [ADR-001](./adr/ADR-001-mvp-agent-authentication.md) | MVP Agent Authentication via X-Agent-Id Header |
| [ADR-002](./adr/ADR-002-jwt-agent-authentication.md) | JWT-Based Agent Authentication via Keycloak Client Credentials |
| [ADR-003](./adr/ADR-003-lineage-visualization-react-flow.md) | Lineage Visualization — React Flow with Dagre Layout |
| [ADR-004](./adr/ADR-004-demo-environment-strategy.md) | Demo Environment Strategy |
| [ADR-005](./adr/ADR-005-connection-reference-composition.md) | Connection Reference as a Composition Primitive (Domain 12) |
| [ADR-006](./adr/ADR-006-runtime-scope-enforcement.md) | Runtime Scope Enforcement Strategy (Domain 12) |
| [ADR-007](./adr/ADR-007-connection-reference-state-propagation.md) | Connection Reference State Propagation (Domain 12) |
| [ADR-008](./adr/ADR-008-connection-reference-and-package-relationship.md) | Connection Reference and Connection Package Relationship (Domain 12) |
| [ADR-009](./adr/ADR-009-notification-architecture.md) | Notification Architecture (Domain 11) |

For the full text of each, see the files in [`adr/`](./adr/).

## Related

- Per-feature build status: [`../prd/implementation-status.md`](../prd/implementation-status.md).
- Active priority and deferral plan: [`../prd/osr-roadmap.md`](../prd/osr-roadmap.md).
