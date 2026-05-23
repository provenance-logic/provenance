# PRD overhaul — anchor decisions

**Author:** Matt McGarvey (decisions); Claude (structuring + rationale capture)
**Date:** 2026-05-23
**Status:** Settled. The six decisions below anchor the 2026-05-23/24 PRD overhaul and the resulting PRD v1.6. All downstream work — ADR-011, PRD v1.6 scope, Phase 5/6 reshape, Phase 4 streaming/REST story — references this document.

---

## Headline

The platform commits to **consumer-grade click-through as the OSR bar**, on the configuration-brokerage primitive ratified 2026-05-22. Cross-org access (request + grant) lives in the requester's namespace with a narrow approval-write carve-out. The inbound-outbound bridge is a single FK with diff-and-prompt re-crawl semantics. The 12-connector enum is reset to the 3 that actually work; types are added back by demand in 6-8-week tranches with Snowflake first. The Power BI bar — a non-engineer connects a real data product to their tool in clicks — becomes the design constraint for every consumer-facing surface.

## What this document is

The [2026-05-22 reframe](consumer-grade-outbound-reframe-2026-05-22.md) opened five questions for the PRD session. The [lift survey](connector-lift-survey-2026-05-22.md) sized the inbound work. The [service-org-filter audit](../audits/service-org-filter-audit-2026-05-22.md) verified tenant-isolation reality. [B-070](../bugs/open.md#B-070) and [B-071](../bugs/open.md#B-071) captured the architectural gaps surfaced by the consumer-persona walkthrough.

This document records the decisions on top of that input. Six anchor calls. Each section names the decision, the rationale, the concrete implications, the rejected alternatives with their reasoning, and the items deliberately deferred.

The conversation that produced this happened 2026-05-23 morning — the first session of the weekend overhaul. Recording it here so the rationale survives session boundaries and can be cited by ADR-011, PRD v1.6, and downstream design work.

---

## Decision 1 — Consumer-grade click-through is the OSR bar

**Position.** OSR ships when a non-engineer can land on a data product page in Provenance, pick a tool (Python, SQL client, Power BI, Tableau, JDBC, dbt), receive a ready-to-use configuration snippet or download, and end up connected to the data — without writing JSON, parsing a JDBC URL, or asking a data engineer for help. The four personas (AI Agent, Domain Team, Data Consumer, Governance Member) all get first-class surfaces; none is required to read raw `connection_details`.

**Rationale.** Without this bar, the platform fails on its own framing. A data mesh is defined by self-serve consumption across domains; an engineer-grade catalog that requires JDBC literacy serves data engineers, not data consumers. The reframe doc names the Power BI bar as the test — that test stands.

**Concrete implications.**
- OSR target slips from vague-Q3-2026 to **~Q4-2026** (3-4 months tight per the reframe sizing; 5-7 months padded).
- Phase 5 reshapes. The current 5.X items (anomaly detection, SOC 2 foundations, dev experience tail) compete against six new workstreams: inbound-outbound bridge, situation detection, six-destination snippet generator, catalog-name abstraction, connection-test layer, credential-lifespan UX.
- The cross-org marketplace promise is on the hook to actually work end-to-end (Snowflake shares, Delta Sharing), not just be a UI surface.
- "Backend endpoints respond correctly" is *API-complete*, not *phase-complete*. CLAUDE.md's user-visible-surface rule applies to every advertised capability under the new bar.

**Rejected: stay engineer-grade.** Defensible market position (agent-first mesh) but consumer walkthroughs land the same way the 2026-04-18 walkthrough did. Most agent infrastructure today is built or supervised by humans, so a hostile human surface kills the agent surface too. The "AI agents are our wedge" argument is real but doesn't survive the persona-walkthrough test.

**Deferred.** None for decision 1 itself. Specific reshapes flow from the downstream decisions.

---

## Decision 2 — Configuration brokerage, not credential brokerage

**Position.** Provenance brokers configuration — host, catalog name, snippet for the user's tool of choice. The user supplies their own source-system identity. The platform never holds, mints, or proxies user credentials. Manual permission provisioning by the product owner is acknowledged as a known platform limitation, to be automated over time as source-system integration matures.

**Rationale.** Anchored 2026-05-22. Keeps Constraint 3 (data plane stays in domain infrastructure) holding without strain. Shrinks the consumer-grade lift from ~3-5 months / per-source-type forever to ~3-4 months for a tight first cut. The Dehghani third-principle gap is named honestly rather than papered over.

**Concrete implications.**
- Snippets contain configuration, not credentials. Python snippet has host + database + catalog name; user pastes their own Snowflake login when running it. Power BI snippet drops the user into Power BI's existing OAuth flow against the source.
- The TTL / 14-day / 7-day expiry warnings in the user story refer to *grant* expiry, not credential expiry. Grants are platform-issued; credentials remain the source's responsibility.
- The Situation B "owner provisions permission in source system" step stays manual at OSR. The roadmap commits to automating it as source-system identity integration matures, but it's not in OSR scope.

**Rejected: credential brokerage.** Platform mints and rotates federated credentials per grant. Months of per-source-type integration plus credential-lifecycle infrastructure. Would re-blur Constraint 3. Deferred indefinitely; not a roadmap item beyond "matures over time."

**Deferred.** Automated source-system credential federation. Tracked as the user story's "known platform limitation" and the operational metric "time-to-access from owner approval to consumer connect."

See: [`feedback_osr_means_every_connector_real.md`](../../../.claude/projects/-home-ec2-user-provenance/memory/feedback_osr_means_every_connector_real.md) and [`project_consumer_grade_configuration_brokerage.md`](../../../.claude/projects/-home-ec2-user-provenance/memory/project_consumer_grade_configuration_brokerage.md) in session memory.

---

## Decision 3 — Cross-org access-request ownership: Model A

**Position.** `access.access_requests` and `access.access_grants` rows live in the **requester's org** namespace. The existing `orgId` column means "the requester's org" — that's what `submitRequest` already does. The product owner sees a cross-org *read* of "requests against my products" via the same `@AllowCrossOrgRead` pattern that B-068 closed for product-metadata reads. The approval action is a **cross-org write** against the requester's row, executed by the product owner, gated by a new `@AllowCrossOrgWriteForApproval` decorator.

**Rationale.** Matches the consumer mental model ("this is my request") that the consumer-grade framing requires. Preserves ADR-010 step 1's discipline — every query still filters on `orgId = ctx.orgId`; the cross-org carve-out is a named, narrow exception. Zero schema impact. Pattern-consistent with B-068's resolution.

**Concrete implications.**
- New decorator `@AllowCrossOrgWriteForApproval` on `approveRequest` and `denyRequest`. Waives the URL/JWT `orgId` match. Service-layer validates that the caller is the product owner for the product the request is against; reject otherwise.
- B-071's two symptom halves both close: line 412's `ForbiddenException` removed; line 515's `findOne({ where: { id, orgId } })` rewritten to look up by `id` only, gated by the decorator and the service-layer ownership check.
- Cross-org write is **audit-logged with a distinct event type** so the carve-out usage is observable. The audit row records (requester_org_id, product_owner_org_id, action, approver_principal_id).
- The product owner's "queue of incoming requests" is a cross-org read query that scans `access_requests` filtered by `productOwnerOrgId = ctx.orgId` (via a new column, OR derived from a join to `data_products`). Recommend a derived view to avoid the schema add — but a join on `data_products.org_id = ctx.orgId` works without schema change.

**Rejected: Model B — split lifecycle, request in owner's org, grant in requester's org.** The Dehghani-purist answer. Rejected because cross-tenant transactional consistency in TypeORM is awkward and the consumer's UI would show stale "pending" states during the gap between owner-update and consumer-insert. Two rows in two namespaces that need to stay consistent is a bug class the platform doesn't need.

**Rejected: Model C — shared marketplace namespace.** The architecturally honest long-term answer at scale. Rejected for OSR because it contradicts ADR-010 step 1's just-landed `orgId = ctx.orgId` discipline. Introduces a parallel tenancy model that's more cost than benefit at current scale (two orgs in the marketplace, demo-scale request volume). Revisit when the marketplace has many orgs and high request throughput.

**Deferred.** Notification cross-org routing. B-071's adjacent finding flags that the notification fired on request submission carries the requester's `orgId` but the recipient is in the owner's org. None of A/B/C answers cleanly which org's notification queue owns cross-org notifications. To be settled in the notification subsystem design pass, not here.

---

## Decision 4 — Inbound-outbound bridge: single FK with diff-and-prompt semantics

**Position.** Migration V32+ adds two columns to `port_declarations`:
- `source_registration_id UUID NULL REFERENCES connectors.source_registrations(id)`
- `source_object_path TEXT NULL`

`ProductEnrichmentService.resolveColumnSchema` and `freshness.lastRefreshedAt` consult the FK; both fall back to the existing hand-authored `contract_schema` / hand-authored values when NULL. Producer UI gains a "Pick from discovered objects" path on port create/edit. Re-crawl conflict surfaces as a diff prompt to the producer — never silent overwrite, never silent staleness.

**Rationale.** Closes B-070's architectural gap (inbound and outbound halves are independent today). Makes discovery the primary path on the producer side in click-through publishing while preserving the CLAUDE.md "domain-declared takes precedence" rule. Minimal schema, maximum flexibility.

**Concrete implications.**
- Existing hand-authored ports stay valid — NULL FK is the legacy state.
- Schema resolution path: port → source_registration → latest `schema_snapshot` filtered by `source_object_path` → `contract_schema`. Hand-authored values override per-field; the override mechanism stays JSONB-on-port for MVP.
- Producer UX shifts from "type a JSON Schema" to "select a discovered object; tweak the auto-populated fields where needed." This is the consumer-grade publishing flip.
- Re-crawl semantics: when `schema_snapshots` changes for a bound object, the platform shows the producer a diff and prompts accept/reject. Auto-override only if governance has explicitly configured it. Never silent.

**Rejected: join table (`port_sources`) for many-to-one bindings.** Right for the long term but YAGNI for OSR. Multi-source ports are rare; the producer can model that case as a view in the source system. **Revisit post-OSR** if a real use case forces it. A migration from FK to join table later is straightforward (data move + FK drop).

**Rejected: FK directly to `schema_snapshots`.** Binds the port to a specific point-in-time snapshot. The FK becomes stale on every re-crawl. `source_registrations` is the durable entity; binding there + naming the object path is the right granularity.

**Rejected: structured JSONB for `source_object_path`.** Source connectors already know how to interpret a path string. Loose TEXT matches "the producer typed/selected a path." Tighten to structured later if validation becomes worth it.

**Deferred.** Multi-source ports / join table. Catalog-name source-side view creation as a producer-publishing flow — settled at the framing level by decision 6a but the UX of "create the view through Provenance" vs "ask the producer to create it manually in their warehouse" is downstream design work.

---

## Decision 5 — Connector coverage: cut now, add back in tranches

**Position.** **Option 3 + Option 4 combined:**

**Step 1 (within days).** Remove the 9 unimplemented connector types from the enum, registration UI, and capability manifest list. The platform claims 12 types today; it ships 3 (postgresql, s3, databricks). The other 9 are removed, not labeled "Experimental."

**Step 2 (ongoing, ~6-8 weeks per tranche).** Add connector types back one at a time, each one done end-to-end at the consumer-grade bar: real probe, real schema inference, real discovery crawl (where the source supports it), capability manifest, situation detection (A/B/C), snippet generators for relevant destinations, connection test, catalog-name abstraction. Order by demand.

**OSR target set: postgresql + s3 + databricks + snowflake.** Four types, each end-to-end consumer-grade. Snowflake is the next add, scoped at ~6-8 weeks.

**Post-OSR tranche queue:** bigquery, mysql, then everything else by demand. Streaming (kafka, redpanda), REST, and custom are **deferred entirely** until the reframe-doc Q5 question is settled — the A/B/C user story doesn't map cleanly to those shapes; they need a different story before they can ship.

**Rationale.** Option 1 (all 12) is 30-40 weeks at the new bar — OSR pushes to mid-2027. Option 2 ("experimental" labels) is the industry-precedented compromise but Matt rejected it on the truth bar: a half-warning is still a half-lie. Option 3 alone ends the lie immediately; Option 4 alone keeps the lie until each one ships. Combined, the lie ends now and the roadmap is real.

**Concrete implications.**
- Breaking API change: removing types from the connector-type enum is API-breaking for anyone who has scripted registration against those types. Mitigate with a one-time cleanup migration (drop any fake connector rows in the removed types) + CHANGELOG note. Pre-launch the breakage is mostly hypothetical.
- The marketplace at OSR demonstrably supports four data-tier archetypes: OSS relational (PG), warehouse (Snowflake), lakehouse (Databricks), object storage (S3). Cross-org primitives are real for Snowflake and Databricks.
- The marketplace at OSR does **not** demonstrably support streaming or REST as data products. The PRD names this gap explicitly and points to the post-OSR story for those source classes.

**Rejected: Option 1 — implement all 12.** OSR slips to mid-2027 at best. Not consistent with the stated OSR target.

**Rejected: Option 2 — "experimental" labels.** k8s alpha/beta and Postgres extension flags are industry precedent for the pattern. Matt's truth bar — "every advertised connector type actually works" — rejects half-warnings as still a half-lie. If consumers see a registration option in the UI, the platform is implicitly claiming it works; labels don't change that perception.

**Deferred.**
- Streaming (kafka, redpanda) story shape. The A/B/C trichotomy doesn't map cleanly to topic-level ACLs; needs a different user story.
- REST API connector story shape. OAuth scopes don't map cleanly to A/B/C either.
- `custom` connector type — generic shape, not a specific source. May not be a "connector" at all in the new framing; potentially deleted from the enum entirely.
- Per-port join table (carried forward from decision 4).

---

## Decision 6a — Catalog name abstraction: source-side view where supported

**Position.** Catalog name (e.g., `customer-360`) is the user-facing primitive. Physical naming (`prod_warehouse_v2.sales_mart.customer_360_legacy_2024`) never appears to the consumer. Translation mechanism per source type:

| Source type | Mechanism | Notes |
|---|---|---|
| postgresql | (a) Source-side view | Producer creates view in source; port binds to view name. Snippet uses view name. |
| snowflake | (a) Source-side view | Same. Snowflake also supports secure views as the cross-org share primitive. |
| databricks | (a) Source-side view | Unity Catalog views. Producer-facing UX in port publishing. |
| s3 | (b) UI-only | S3 has no view primitive. Snippet references bucket/prefix; Provenance UI shows the catalog name only. |

**Rationale.** Source-side views keep the abstraction durable past Provenance's UI (the consumer's tool sees the friendly name). UI-only abstraction leaks the moment the consumer opens their tool — acceptable as fallback where the source doesn't support views, unacceptable as the primary mechanism.

**Concrete implications.**
- Producer publishing UX includes "create the view in the source" as a step where applicable. The platform can offer to generate the `CREATE VIEW` DDL but does not execute it (data plane stays in domain).
- Catalog names live as a column on `port_declarations` (`catalog_name TEXT NOT NULL` or similar — already partially modeled today, needs verification).
- For S3 ports, the catalog name is purely a Provenance-side display label; the snippet for S3-targeted tools uses the bucket/prefix path. This gap is named in the PRD as a known abstraction leak for object storage sources.

**Rejected: (b) UI-only as the primary mechanism.** Cheaper engineering but the abstraction breaks the moment the consumer leaves Provenance — the Power BI / dbt / Tableau snippet would show `prod_warehouse_v2.sales_mart.customer_360_legacy_2024`. Defeats the Power BI bar from decision 1.

**Deferred.** Whether Provenance generates and offers DDL automatically, or asks the producer to write it manually. UX question, downstream of the bridge work.

---

## Decision 6b — Cross-org marketplace consumption primitives

**Position.** Per source type:

| Source type | Primary cross-org primitive | Fallback |
|---|---|---|
| snowflake | (a) Native data shares | (c) Contact-the-owner |
| databricks | (a) Delta Sharing | (c) Contact-the-owner |
| postgresql | — | (c) Contact-the-owner only. No native cross-org primitive. |
| s3 | (b) Bucket-policy grants to external AWS principals | (c) Contact-the-owner |

**Rationale.** The data mesh marketplace promise requires real cross-org primitives where the source supports them. Snowflake and Databricks have first-class share mechanisms; the platform brokers the share name + sharing-account-id metadata, the consumer's own Snowflake / Databricks account connects to it. For PG, there is no equivalent — cross-org PG consumption is "manually grant the consumer an account or replicate to their environment." For S3, bucket policies referencing external AWS principals work; this is documented as a fallback shape with the friction acknowledged.

**Concrete implications.**
- The PRD names which source types the marketplace cross-org promise applies to. Snowflake + Databricks at OSR.
- For PG products, the marketplace surface still works (browse, request, owner approves), but consumption requires the owner's manual GRANT in their own PG — the F-acknowledged limitation in the user story.
- For S3 products, consumption requires the owner to add the consumer's AWS principal to the bucket policy — same friction, same acknowledgment.

**Rejected: (a) only.** Some source types simply lack native cross-org primitives. Forcing (a) everywhere would either misrepresent PG capabilities or push PG out of the OSR set. Decision 5 puts PG firmly in the OSR set; honest (c) labeling is the right move.

**Deferred.** Whether the PRD positions the Snowflake / Databricks cross-org primitives as "this is how the marketplace works" or "this is how the marketplace works *for these sources*." Marketing positioning, downstream of the technical decision recorded here.

---

## Decision 6c — Situation detection: layered

**Position.** A/B/C detection (does the consumer have a source-system account; do they have product-level access) is a layered determination:

1. **Producer declaration as primary.** Producer marks per port: "this product is Situation-A-eligible" (e.g., grant has been issued to PUBLIC or to a broad role). Cheap, accurate where the producer is honest.
2. **Probe-based verification as fallback.** When a consumer hits the connect flow, the platform optionally probes "can the consumer's identity actually reach this object?" Returns a confidence signal, not a hard gate. Catches producer mis-declarations before the consumer leaves Provenance.
3. **Directory integration as post-OSR hardening.** Future: ask the source's identity primitive directly ("does user X have a Snowflake account?"). Adds a third truth source but requires platform-side credentials to the source's identity primitive — a credential-broker-shaped requirement that the current configuration-brokerage framing excludes from OSR scope.

**Rationale.** Single-source detection is fragile. Producer declaration alone trusts the producer to keep it accurate as source-system state changes; probe alone has privacy and side-effect concerns; directory alone requires platform creds in the source. Layered = declaration as the cheap default, probe as the live-check verification, directory as future hardening when credential infrastructure is in place.

**Concrete implications.**
- Producer port declaration grows a `situation_a_eligibility BOOLEAN` field (or richer enum if eligibility varies). Defaults to false — producer must affirm.
- Probe is per-source-type; for Snowflake / Databricks / PG the probe is "try a `SELECT 1` against the catalog name with the consumer's identity." Returns success / permission-denied / connection-failed. Used to verify, not gate.
- The connect flow surfaces probe failures to the consumer with actionable language: "Your account doesn't appear to have access yet — request access here."

**Rejected: probe-only.** Probes against the consumer's identity have side-effect concerns (some sources audit failed permission checks; some sources rate-limit auth failures). Producer declaration is the cheap fast-path; probe runs only where declared eligibility needs verification.

**Rejected: directory-integration-only at OSR.** Requires platform-side credentials to the source's identity API — exactly the credential-brokerage shape decision 2 excludes from OSR. Post-OSR hardening item.

**Deferred.** Directory integration entirely. Probe semantics for source types where `SELECT 1` doesn't apply (Kafka topic membership, REST OAuth scope check) — covered by decision 5's deferral of streaming / REST connector stories.

---

## Aggregate deferred list

Carried forward from the above decisions for tracking in the PRD overhaul, ADR-011, and the bugs / open-questions documents:

1. **Notification cross-org routing.** Which org's queue owns cross-org notifications. (Decision 3.)
2. **Port join table for multi-source ports.** Single FK is MVP; revisit post-OSR if a use case forces it. (Decision 4.)
3. **Streaming connector story shape (kafka, redpanda).** A/B/C doesn't map cleanly to topic-level ACLs. (Decision 5.)
4. **REST connector story shape.** OAuth scopes don't map cleanly to A/B/C. (Decision 5.)
5. **`custom` connector type.** May not be a "connector" in the new framing; potentially removed from the enum. (Decision 5.)
6. **DDL generation for catalog-name views.** UX question — auto-generate, offer, or producer-manual. (Decision 6a.)
7. **Source-system directory integration for situation detection.** Requires platform-side credentials to source identity primitive; post-OSR. (Decision 6c.)
8. **Automated source-system credential federation.** Replaces the manual GRANT step in Situation B. Acknowledged in the user story as the path beyond OSR. (Decision 2.)
9. **Marketplace positioning for cross-org gaps.** PG / S3 don't have first-class cross-org primitives the way Snowflake and Databricks do — marketing copy decision. (Decision 6b.)

---

## What this means for the PRD overhaul

The PRD v1.6 overhaul references this document as its decision anchor. Specifically:

- **Section restructure around the four personas.** The consumer-grade bar (decision 1) makes the four personas load-bearing rather than aspirational; each gets a dedicated section.
- **Phase 5 reshape.** Anomaly detection, SOC 2 foundations, dev-experience tail are re-evaluated against the six new consumer-grade workstreams (bridge, situation detection, snippet generator, catalog-name abstraction, connection-test layer, credential-lifespan UX). What survives, what defers, what merges.
- **Phase 6 boundary.** Production-scale hardening items previously in Phase 6 (managed AWS, Kubernetes, SOC 2 Type II) stay there. Source-system directory integration and automated credential federation move into Phase 6 or later.
- **Connector chapter rewrite.** B-063's Option 3 + 4 (decision 5) means the connector chapter ships with PG + S3 + Databricks as fully documented; Snowflake as next-tranche; everything else as roadmap. Streaming / REST get their own forward-looking section with the deferred-story acknowledgment.
- **New chapter or appendix on configuration brokerage.** Decision 2's framing — what the platform does and explicitly doesn't do — deserves dedicated treatment. Likely the ADR-011 content gets distilled into a PRD appendix.

## What this does NOT change

- **The five non-negotiable architectural constraints.** Lineage graph stays Neo4j. OPA stays hot-reloadable. Control / data plane separation holds (decision 2 explicitly preserves it). Agent Query Layer stays separate. MCP stays native.
- **The four-persona model.** Consumer-grade reframes how each persona is served, but the four are unchanged.
- **The lineage / governance / observability subsystems.** Phase 3 and Phase 4 work is not in scope for the overhaul. Domain 12 (connection references) is settled and ships within Phase 5.
- **CLAUDE.md's discipline rules.** Spec-first, migration-first, test-first, audit-log append-only, etc. None of these change.
- **Domain 12 deferred items.** Supervised oversight-hold sub-state, governance override, MAJOR-version suspension, automatic expiration, F12.21 cascade triggers, per-reference scope filtering, agent self-discovery MCP tool, legacy-ref UI. Still deferred; not pulled into the overhaul.

---

## References

- [Consumer-grade outbound reframe (2026-05-22)](consumer-grade-outbound-reframe-2026-05-22.md) — the user story and the five open questions this document answers.
- [Connector lift survey (2026-05-22)](connector-lift-survey-2026-05-22.md) — inbound sizing per source type.
- [Service-org-filter audit (2026-05-22)](../audits/service-org-filter-audit-2026-05-22.md) — tenant-isolation reality, ADR-010 step 1 anchor.
- [Claim-vs-code audit (2026-05-22)](../audits/claim-vs-code-2026-05-22.md) — the earlier audit that surfaced the doc-drift findings (B-064, B-065, B-067).
- [B-063 — Connector framework register-only](../bugs/open.md#B-063) — settled by decision 5.
- [B-070 — Inbound-outbound bridge missing](../bugs/open.md#B-070) — settled by decision 4.
- [B-071 — Cross-org access requests structurally broken](../bugs/open.md#B-071) — settled by decision 3.
- [ADR-010 — RLS by default (step 1 landed 2026-05-22)](adr/ADR-010-rls-by-default.md) — the discipline decision 3's carve-out has to preserve.
- ADR-011 (forthcoming) — distillation of decisions 1 and 2 into a single architectural decision record. Drafted off this document.
