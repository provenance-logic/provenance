# Provenance — Known Limitations

**Last updated:** April 13, 2026 — Phase 4 complete

---

## Current State

Provenance implements the full data mesh architecture: domain ownership, data as a product, self-serve infrastructure, and federated computational governance. Phase 4 delivers the Data 3.0 milestone — AI agents as first-class mesh participants via a fully compliant MCP server with semantic search, agent identity, trust classification, and a complete audit trail.

The platform is under active development. The limitations listed here are known, tracked, and planned. They are implementation tasks on a solid foundation — not design gaps.

---

## What Works Today

The following capabilities are implemented and verified working:

**Data product management**
- Full product lifecycle (Draft → Published → Deprecated → Decommissioned)
- Port definitions, semantic versioning, governance compliance
- Mutable name, description, and tags on published products with automatic re-indexing

**Agent interface (MCP)**
- Fully compliant MCP server via SSE on port 3002
- 9 tools: `list_products`, `get_product`, `get_trust_score`, `get_lineage`, `get_slo_summary`, `search_products`, `semantic_search`, `register_agent`, `get_agent_status`
- Semantic search (all-MiniLM-L6-v2, 384 dimensions, kNN cosine similarity)
- Keyword search (BM25)
- Natural language query translation via Claude API with graceful fallback

**Trust and observability**
- Trust score with component breakdown (lineage completeness, SLO compliance, governance compliance, schema conformance, freshness)
- SLO health with 7-day and 30-day trend data
- Lineage graph with upstream sources and downstream consumers including external systems

**Agent identity and governance**
- Agent registration and trust classification (Observed / Supervised / Autonomous)
- Classification transition rules with governance enforcement
- Frozen state for in-flight operations on classification downgrade
- Complete audit trail with agent identity context on every MCP tool call
- Audit log query API (filter by agent_id, event_type, time range, principal_type)

---

## Known Limitations — Near-Term Roadmap (Phase 4c / Early Phase 5)

These are Priority 1 gaps that most directly affect whether an agent or human consumer can fully evaluate and use a data product. Targeted for Phase 4c or early Phase 5.

**Column-level schema not yet exposed**
The `get_product` MCP tool returns port definitions (name, type, interface) but not the schema of the data itself — no field names, data types, nullability, or field descriptions. Schema snapshots exist in the database; surfacing them through the agent interface is the work. An agent cannot currently determine whether a data product contains the fields it needs without schema.

**Ownership and stewardship contacts not yet exposed**
The platform knows which domain a product belongs to, but agent and consumer queries do not yet return the data product owner name and contact, domain team name, or creation and update timestamps.

**Data freshness signals not yet exposed**
SLO health is surfaced, but the actual freshness of the underlying data is not. An agent cannot currently determine when data was last successfully refreshed or whether it meets its freshness SLA.

**Access status for requesting principal not yet exposed**
The `get_product` tool returns product details regardless of the requester's access status, but does not yet indicate whether the requesting agent or consumer currently has access, has a pending request, or has never requested access.

---

## Known Limitations — Phase 5

These are meaningful additions planned for Phase 5.

**~~Agent authentication is self-reported in MVP~~ — Resolved (April 16, 2026)**
Agent authentication now uses Keycloak `client_credentials` JWTs validated on every MCP request (ADR-002). Agent identity is cryptographically verified, not self-reported. The Phase 4 `X-Agent-Id` header pattern has been superseded. Pre-existing agents can be migrated via `POST /agents/:agentId/provision-credentials`.

**Anomaly detection not yet implemented**
The platform captures a complete audit trail of all agent activity but does not yet detect anomalous behavioral patterns or trigger automatic escalation. Anomaly detection requires a behavioral baseline that does not exist until activity tracking has run in production. Phase 5 delivers anomaly detection and Temporal-based escalation workflows.

**Data quality signals, versioning history, and compliance metadata not yet in get_product**
These are Priority 2 additions planned for Phase 5.

**Infrastructure hardening not yet complete**
The platform currently runs on a two-EC2 Docker Compose architecture. Phase 5 delivers microservices decomposition, migration to managed AWS services (Aurora, Neptune, MSK, Amazon OpenSearch Service), Kubernetes on EKS, security hardening (VPC, mTLS, WAF, KMS), and SOC 2 readiness.

---

## Architecture Is Designed for These

All of the limitations above are implementation tasks, not design gaps. The architecture was built to accommodate them:

- Schema snapshots are already stored in `connectors.schema_snapshots` — surfacing them is a targeted API change
- Ownership and freshness data exists in the products and observability schemas — surfacing it is a targeted API change
- The `agent_trust_classifications` table includes a `scope` field ready for per-domain classification post-MVP
- The audit log is complete and queryable — anomaly detection builds on top of it in Phase 5
- All service boundaries are defined — Phase 5 microservices extraction is mechanical, not architectural

---

*For the complete requirements and architecture, see `documents/prd/Provenance_PRD_v1.4.md` and `documents/architecture/Provenance_Architecture_v1.4.md`.*
