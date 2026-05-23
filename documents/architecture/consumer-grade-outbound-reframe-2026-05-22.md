# Consumer-Grade Outbound: Reframe and Sizing — 2026-05-22

**Author:** Drafted by Claude during the 2026-05-22 evening session as input for the **2026-05-23/24 weekend PRD overhaul**.
**Triggered by:** A persona walkthrough on the dev stack (https://dev.provenancelogic.com) — the first consumer-persona walkthrough in this project's history. The walkthrough was scoped as "find what's hollow on the outbound side" and surfaced a finding bigger than the original B-063 framing: the platform was being built toward the wrong shape of consumer experience entirely.
**Purpose:** Capture the reframe, the user story Matt drafted in-session, and the sizing implications before tomorrow's PRD work begins. **Not a PRD. Not a plan. A finding doc** — peer to the [connector lift survey](connector-lift-survey-2026-05-22.md) and the [claim-vs-code audit](../audits/claim-vs-code-2026-05-22.md).

---

## Headline

The platform has been building toward **credential brokerage** (Provenance mints federated credentials per grant, owns credential lifecycle end-to-end). The right cut is **configuration brokerage** (Provenance tells the user's tool *where* to point and *what to call it*; the user supplies their own source-system identity at use time).

The consumer doesn't see the difference. From their POV it's still click → pick tool → get a snippet → connect. But the platform's work shrinks substantially because Provenance never holds or mints user credentials. It just brokers the configuration package that lets Power BI / Tableau / Python / dbt point at the right thing under the right name.

**Sized lift to make the platform consumer-grade by the Power BI bar:** ~3-4 months focused engineering for a tight first cut (2 source systems × 6 destination tools). **OSR slip: ~Q4-2026** (from vague-Q3-2026), not multiple quarters.

**What this displaces:** the rough Phase 5 → Phase 6 boundary. Phase 5 (Open Source Ready) becomes "consumer-grade outbound" rather than "operationally ready." Phase 6 (Production Scale) stays as managed-AWS / EKS / SOC 2 — not changed by this reframe.

---

## What surfaced this

The 2026-05-22 evening session pulled the dev stack forward to current main (`dc35cfc`, 22 PRs ahead) and ran a consumer-persona walkthrough as `analyst@acme.example.com`. Findings in walk order:

1. **Marketplace cross-org break.** Clicking "KYC Profiles" (owned by `beta-industries`) from the acme analyst's marketplace view returned **"Org scope mismatch: token is scoped to a different organization than the URL targets."** Root cause: [B-061](../bugs/resolved.md#B-061) added a `JwtAuthGuard` check that rejects requests where URL `:orgId` ≠ JWT `:orgId`. The marketplace is cross-tenant **by design** (data mesh = discover products from other orgs). B-061 closed a real cross-org information leak but did not carve out the marketplace's intentional cross-tenant read path. Filed as **B-068**.
2. **Hardcoded placeholder template on every product detail page.** The "How to consume" snippet on the Ports tab is a static map at `apps/web/src/features/discovery/ProductDetailPage.tsx:29-39`, one template per interface type:
   - `sql_jdbc`: `jdbc:<driver>://<host>:<port>/<database>?user=<principal>&sslmode=require`
   - `rest_api`: `curl -H "Authorization: Bearer $TOKEN" https://<base-url>/<resource>`
   - `graphql`: `POST https://<base-url>/graphql with { query }`

   These templates **never read the port's actual `connection_details` JSON**. The platform stores rich per-port connection details (per F10.5/F10.6/F10.8 — `revenue-sql` has `jdbc:postgresql://warehouse.acme.example.com:5432/finance` and a working psql example in the seed), but the UI renders literal `<host>` placeholders instead. The dynamic `ConnectionDetailsPanel` (line 440+) DOES read the actual values, but appears below the static template — UX inversion. Filed as **B-069**.
3. **Empty `connection_details` for several seeded ports.** `daily-revenue-report-output` was the port walked first; its `connection_details` column was `NULL`. Multiple other ports have the same (10 of 19 published output ports). Filed as part of B-070.
4. **The inbound-outbound disconnect.** This is the architectural finding. `port_declarations` has **no foreign key** to `source_registrations` or `schema_snapshots`. The Databricks discovery framework writes to `connectors.schema_snapshots`, `connectors.discovery_crawl_events`, `lineage.emission_log`. The consumer-facing surface reads from `products.port_declarations.contract_schema` (hand-authored JSON Schema). **There is no service-level wiring that says "I just discovered this Databricks table — auto-populate or update a port pointing at it."** The two `null`-returning stubs in `ProductEnrichmentService` (`resolveColumnSchema`, `freshness.lastRefreshedAt`) admit this — both have been "non-blocking" because the UI falls back to hand-authored data. Promoted from "non-blocking" to load-bearing-gap. Filed as **B-070**.
5. **Credential model ambiguity.** Even with the bridge built, what does a granted consumer actually receive? Reading the code: a `connection_details` blob with an endpoint and a Secrets Manager ARN reference. The platform does not deref the ARN, does not mint a short-lived federated credential, does not proxy the connection. The consumer needs their own AWS IAM to read the ARN — which means cross-org consumers (Org B reading Org A's secret) cannot actually USE the data even when granted. This is the deepest finding and the one that triggered the reframe.

These five findings, taken together, expose that the platform's outbound surface assumes the consumer is a data engineer who knows what to do with a JDBC URL and an ARN. The platform was being built for engineers, not for the four personas the PRD names (AI Agents, Domain Teams, Data Consumers, Governance Teams) — **none of whom should need JDBC literacy**.

---

## The framing finding

Matt's articulation, paraphrased from the session:

> *"If I'm in Power BI and I want to connect to another data source, there is a click-through UI. If you make this so only data engineers can understand and use it, we have failed."*

The Power BI bar. A non-engineer opens Provenance, finds a data product, clicks "Connect" or "Use this." The platform handles every piece of plumbing — auth, configuration, identity assertion, expiry — and the consumer ends up with the data flowing into their tool of choice. They never see a JDBC URL. They never see an ARN. They never read JSON.

What that means concretely:

- **Click-through connect.** "I want to use this in Power BI / Tableau / Python / SQL client / JDBC / dbt." The platform generates the configuration snippet or download for that destination. No copy-paste of opaque strings.
- **The output of the access flow is a working connection, not a credentials blob.** Today the flow ends at "here are connection_details, good luck." That has to flip: the flow ends at "you're connected" (or "you have everything your tool needs to connect — open Power BI and the catalog appears").
- **The catalog name is the user-facing primitive.** Consumer sees `customer-360`, not `prod_warehouse_v2.sales_mart.customer_360_legacy_2024`. Physical naming leakage is the #1 thing that makes a catalog feel like a thin wrapper around a DBA's spreadsheet.
- **The producer side has to support this too.** A domain team can't hand-author a `connection_details` JSON and walk away. They have to declare "this port = these tables in [source]" through a discovery-aware UI. That's why the inbound-outbound bridge matters: discovery isn't optional metadata, it's the spine that makes consumer-grade connect possible.
- **The four personas are non-negotiable.** None of them — AI Agent, Domain Team, Data Consumer, Governance Member — should require JDBC literacy. Today the surface assumes they all do. This is the inversion.

---

## The user story (Matt McGarvey, 2026-05-22)

> **As a** data consumer who has found a data product I want to use,
> **I want to** receive everything I need to connect to that data in my tool of choice,
> **so that** I can start using the data without involving anyone else or figuring out infrastructure details on my own.
>
> ## Acceptance Criteria
>
> The platform shall detect which of three situations the user is in and route them accordingly.
>
> ### Situation A: I already have access to the data product
> *The data product owner has made the product available to all users with a valid source system account, and I have one.*
>
> 1. I am not asked to request access — the connection experience is available to me immediately from the data product page.
> 2. I can select my tool from a supported list (Python, SQL client, Power BI, Tableau, JDBC, dbt) and the platform generates a ready-to-use connection snippet or configuration for that tool.
> 3. The connection details use the data product's catalog name — I am not expected to know the underlying Snowflake database, schema, or object name.
> 4. I can run a connection test from within the platform that confirms I can reach the source system and query the data product, or tells me specifically what is failing with an error code and an option to contact support.
>
> ### Situation B: I have a source system account but not access to this specific data product
> *I have a Snowflake account but have not been granted access to this particular data product.*
>
> 1. The platform presents me with an access request form capturing my identity (from SSO), my team, my use case, the access level I need, and the duration.
> 2. The request is routed to the data product owner for approval. The owner's response SLA is determined by the organization's federated governance policy — not set by the platform.
> 3. I receive status notifications (submitted → approved/denied) without needing to follow up manually.
> 4. If denied, the platform tells me why and what I could do differently.
> 5. Upon approval, the data product owner grants the necessary permission in the source system. **Note: this is a manual step by the owner and represents a known friction point relative to Dehghani's self-service intent. It should be treated as a platform limitation to be automated over time as source system integration matures.**
> 6. Once permission is granted, I am notified and the connection experience in Situation A becomes available to me.
>
> ### Situation C: I do not have a source system account at all
> *I have no Snowflake account or equivalent credentials for the source system where this data product lives.*
>
> 1. When prompted for credentials, I see a clearly labeled "I don't have access to this system" option.
> 2. Selecting it surfaces a plain-language explanation that I need a source system account before I can connect to any data product on that platform.
> 3. The platform provides a direct link to contact the data product owner, who can advise on how to obtain source system access. The platform does not attempt to manage this process — it is explicitly out of scope.
>
> ## Credential Lifespan
>
> 1. Access granted under Situation B shall have a TTL matching the duration the user requested and the owner approved.
> 2. The platform shall notify the user at 14 days and again at 7 days before expiry, with a one-click renewal option.
> 3. If the original access was open to all source system users (Situation A), renewal is automatic.
> 4. If the original access required owner approval (Situation B), renewal re-triggers the same approval workflow — it does not silently extend.
> 5. If credentials expire, the platform shall surface a clear expiry message and route the user to the renewal flow rather than silently failing their connection.
>
> ## Out of Scope for This Story
>
> - How the data product owner sets their access policy (open vs. approval-required)
> - What the user does with the data once connected
> - Revoking access
>
> ## Known Platform Limitation
>
> Manual permission provisioning in Situation B creates a human bottleneck that is inconsistent with Dehghani's third principle. The platform should track time-to-access from request approval to owner provisioning and surface this as an operational metric, with a roadmap goal of replacing the manual step with programmatic provisioning via a platform service account in each source system.

### Why this story is the right cut

1. **Configuration brokerage vs. credential brokerage.** The story separates "platform configures the user's tool" from "platform mints federated credentials per grant." The first is achievable. The second is months of per-source-type integration plus credential-lifecycle infrastructure. The story commits to the first and explicitly defers the second as a "known platform limitation" — Constraint 3 (data plane stays in domain) holds without strain.
2. **Catalog name abstraction is the core consumer-grade primitive.** Consumer sees `customer-360`, not the physical path. This is what flips the experience from "thin wrapper around a DBA's spreadsheet" to "data product catalog you can use."
3. **The Dehghani gap is named explicitly.** Situation B step 5 admits the manual GRANT is non-self-service. Naming the limit and committing to automate it later is a much honester position than pretending the platform is fully self-serve. Auditors and customers will respect this; pretending the gap doesn't exist gets the project caught later.
4. **Situations A/B/C map to real source-system states.** Not platform-invented categorization; it's a faithful read of what happens in Snowflake / Postgres / etc. — "share open to all", "ACL on the table needs explicit GRANT", "not in this system at all." The platform's job is to detect which state the user is in and route accordingly.
5. **Six tools is bounded.** Python, SQL client, Power BI, Tableau, JDBC, dbt. That's a scoped engineering problem, not an open-ended one.

---

## Sizing — 3-4 months for a tight first cut

Assumes **2 source systems** (PG + one of Databricks or Snowflake) × **6 destination tools** (Python, SQL client, Power BI, Tableau, JDBC, dbt). Estimates are focused-engineering hours; pad 50-100% for first-of-kind surprises.

| Piece | Best (weeks) | Realistic (weeks) | Notes |
|---|---|---|---|
| Inbound-outbound bridge | 2 | 3-4 | FK from `port_declarations` → `source_registrations`; auto-population path; resolve the `resolveColumnSchema` and `freshness.lastRefreshedAt` stubs in `ProductEnrichmentService`. Foundational — every later piece depends on it. |
| Situation-detection layer (A/B/C) | 2 | 3-4 | Determine whether the user has a source-system account and whether they have product-level access. Combination of producer declaration ("this product is Situation-A-eligible"), directory integration, and probe-based fallback. |
| Snippet generation × 6 destinations | 4 | 6-8 | Python (~1 day), JDBC (~hours), dbt profiles.yml (~1 day), SQL client (~1-2 days), Power BI Custom Connector with M language and gateway support (~1-2 weeks), Tableau TDC or Web Data Connector (~1-2 weeks). Heavy weight on Power BI + Tableau. |
| Catalog name abstraction | 1-2 | 2-4 | Depends on implementation choice (see open questions). Source-side views in the warehouse cleaner but requires producer cooperation. UI-only naming is smaller but leaks. |
| Connection test (service-account probe per source type) | 2 | 3 | Existing port-level probes (REST/GraphQL/Kafka) need to be extended to per-source-type service-account paths. Connection test ≠ probe — it asserts the catalog → physical mapping resolves and is queryable, not just that the source is up. |
| Approve → manual-provision → notify-back workflow | 1 | 1-2 | Most of access-grant lifecycle exists. New: "I've provisioned" affirmation step from the owner; consumer notification when ready; time-to-access operational metric. |
| Credential lifespan (TTL, 14d/7d warnings, renewal) | 1 | 1-2 | Grant TTL exists. New: scheduled warning notifications (Temporal), one-click renewal UI, re-trigger of approval workflow when Situation B renewal lands. |
| Situation C UX | 0.5 | 0.5-1 | Small. Plain-language explainer + contact-owner link. No data plumbing. |
| **TOTAL** | **13.5 weeks** | **20-28 weeks** | ~3-4 months tight, ~5-7 months padded. OSR slips from vague-Q3-2026 to **~Q4-2026**. |

**What's NOT in this sizing:**

- Credential federation per source type (the deferred "automate the manual GRANT" piece). Each source type would add ~6 weeks of per-source-type credential-broker engineering on top. Deferred per the user story's "known platform limitation."
- Cross-org credential federation (Org A's Snowflake share consumable by Org B). Bounded by what source systems natively support (Snowflake yes, Postgres no). See "cross-org and source-system coverage" below.
- Source systems beyond the first two. Each additional source adds ~3-6 weeks (the situation-detection logic, the connection-test path, the per-source connection_details schema).
- Destination tools beyond the first six. Each additional adds ~3 days to 2 weeks depending on tool.

---

## Five open questions for the PRD session

1. **The credential model — confirm.** Does the snippet contain a credential, or just configuration that the user's tool authenticates with their own identity?
   - **Strong reading of user story:** configuration only. The Python snippet contains host + database + catalog name; the user pastes their own Snowflake login when running it. Power BI snippet drops the user into Power BI's existing OAuth flow against the source. This is the cleaner answer and matches the "configuration brokerage" framing.
   - **Weak reading:** snippet includes a credential the user copy-pastes. This collapses back toward credential brokerage and breaks Constraint 3.
   - **Recommend nail down explicitly:** configuration only, OSR-first. The PRD should say this.

2. **Catalog name abstraction — physical translation mechanism.** Two implementations:
   - *(a) Source-side*: Producer creates a view in the source system named `customer_360` pointing at the physical table. Snippet uses the view name. Source handles translation. Clean — Provenance off the data path. Needs producer cooperation; applies only where source supports views (Snowflake yes, S3 no, Postgres yes, Kafka no, REST no).
   - *(b) UI-only*: Provenance shows `customer_360` in its UI but the snippet uses the physical path. Translation only in Provenance's marketing surface, not at runtime. Smaller engineering, but the abstraction leaks the moment the consumer leaves Provenance.
   - **Recommend (a) where supported, (b) as fallback.** PRD should be explicit about which sources support which mode. **Pick a default per source type and document.**

3. **Cross-org marketplace consumption.** The story doesn't explicitly distinguish same-org from cross-org. The marketplace is cross-org *by design*; situations A/B/C all assume the consumer has a relationship with the source system. For cross-org:
   - *(a) Snowflake-style native data shares*: producer in Org A exposes a share consumable by Org B's Snowflake account. Provenance brokers the share-name + sharing-account-id metadata; consumer's tool connects to their own Snowflake. **Native support.**
   - *(b) Guest provisioning*: producer manually provisions Org B's user as a guest in Org A's source system. Friction-heavy but supported by Snowflake / BigQuery.
   - *(c) Situation C as the only path*: consumer has no source-system account anywhere; story routes them to "contact the owner."
   - **The data mesh marketplace's central promise depends on (a) or (b).** Worth being explicit in the PRD about which sources support which mechanism. Postgres and self-hosted sources are very weak on cross-org primitives and may collapse to (c) for any cross-org use.

4. **Situation-detection mechanism.** How does Provenance know which situation the user is in?
   - Producer declaration ("this product is Situation-A-eligible"): cheap, accurate where producer is honest.
   - Directory integration with source system: ask Snowflake "does user X have an account in this Snowflake?" — requires platform-side credentials to the source's identity primitive.
   - Probe-based: try to query as the user, infer from success/failure. Privacy and side-effect concerns.
   - Layered: declaration as primary, probe as fallback, directory as future hardening.
   - **PRD should design this carefully** — bad situation detection sends Situation A users through Situation B's friction or vice versa, and either failure mode degrades the experience badly.

5. **Source-system coverage and primitive mapping.** Story names Snowflake explicitly. The same A/B/C trichotomy maps differently per source type:
   - Snowflake: Situation A = grant to PUBLIC or to a broad role; B = explicit GRANT; C = no Snowflake account.
   - Postgres: Situation A = grant to PUBLIC; B = role-based GRANT; C = not in `pg_authid`.
   - S3: Situation A = bucket policy allows the principal's role; B = ACL or bucket-policy addition required; C = no AWS account.
   - Kafka: Situation A = topic-level ACL allows the principal; B = ACL addition required; C = no Kafka client config.
   - REST: doesn't map cleanly — typically uses OAuth scopes; A/B/C is more like "I'm in your IDP / I'm not."
   - **Some source types (REST, Kafka) may need a different story shape entirely.** Worth being explicit: "this user story is MVP-scoped to relational + warehouse sources; other sources get their own story."

---

## What this means for the connector lift survey

The [connector lift survey](connector-lift-survey-2026-05-22.md) sized the **inbound** engineering: per-connector probe + schema + discovery crawl + (where native) lineage. Those numbers still hold — ~41 hours best-case for all 12 types, ~62-86 hours realistic.

The consumer-grade outbound reframe adds:

- Per-source-system situation-detection logic (≈2-4 weeks each across the 6+ source types relevant for B/C).
- Per-destination snippet generation (≈3 days to 2 weeks each across 6+ destinations).
- The catalog-name abstraction (per source type that supports views).
- Connection-test paths per source type.

**Combined per-source-type cost rises from ~5-15 hours (inbound only) to ~3-6 weeks (inbound + outbound).** That sharpens B-063's strategic choice substantially:

- **Option 1 — implement all 12 types end-to-end:** roughly ~30-40 weeks at the new bar, not 1-2 weeks. Two quarters of focused engineering.
- **Option 2 — narrow to a documented smaller set (PG + Snowflake + Databricks; others marked "Experimental"):** ~12-16 weeks total for the three. Much more credible OSR shape.
- **Option 4 — incremental tranches:** stays viable; ship one source type fully (inbound + outbound + situation detection + 2-3 destinations) per ~6-8 weeks.

The lift survey's framing "Option 1 is plausibly a single focused sprint" no longer holds at the consumer-grade bar. **The fork-in-the-road between Options 1/2/3/4 sharpens.**

---

## What this does NOT change

The reframe shifts the *consumer-side experience*. It does not invalidate:

- **The 5 non-negotiable architectural constraints** (Neo4j for lineage, OPA hot-reloadable, control-plane / data-plane separation, agent query as distinct service, native MCP). All five hold. Configuration brokerage actually reinforces Constraint 3 (data stays in domain).
- **The four personas** (AI Agents, Domain Teams, Data Consumers, Governance Teams). All four still apply; what changes is the bar for "consumer-grade usable" — now Power BI, not psql.
- **Phase 6 (Production Scale).** Untouched — Kubernetes, managed AWS, SOC 2 Type II. Different conversation.
- **Domain 12 (Connection References).** Untouched — still the agent-side consent layer. Configuration brokerage for human consumers does not change the connection-reference flow for AI agents.
- **The B-061 controller-layer guard** (the fix that closed cross-org leak). Holds — except that the marketplace cross-tenant read path needs an explicit carve-out (B-068). The guard's logic for any non-marketplace tenant-scoped route is correct.
- **ADR-010 / B-062** (explicit-orgId-filter as load-bearing tenant isolation). Untouched. Agents.service.ts fix from #161 lands intact.
- **The existing implementation status of Phases 1-4.** Those phases shipped on the engineering-grade definition that was in force at the time. They are not retroactively "incomplete" — they are complete on the old bar. Phase 5 (Open Source Ready) is what reshapes.

---

## Specifically what changes in Phase 5

(For the PRD overhaul author to take as input — not a decision.)

Today's Phase 5 list (per status board):

- ✅ 5.1 Stability and Reliability
- ✅ 5.2 Security Essentials
- ✅ 5.3 JWT Agent Authentication
- 🔄 5.4 Data Product Completeness P1 (substantively shipped; two non-blocking stubs)
- ✅ F5.15 Lineage Visualization
- 🔄 Domain 10 Workstream B (port connection details — mostly shipped)
- 🔲 5.5 Agent Anomaly Detection
- 🔄 5.6 Developer Experience
- 🔲 5.7 SOC 2 Foundations

Post-reframe candidate shape (suggestion for PRD author):

- **5.1 — 5.3:** unchanged, still complete.
- **5.4:** the two "non-blocking stubs" (`resolveColumnSchema`, `freshness.lastRefreshedAt`) get re-classified as load-bearing for consumer-grade outbound. Not a status change to 5.4's existing items — a new dependent line of work.
- **F5.15:** unchanged, complete.
- **Domain 10 Workstream B:** ports exist, but the per-port `connection_details` model needs revision (catalog name abstraction; per-destination snippet target). Likely re-opens.
- **NEW: 5.X — Inbound-Outbound Bridge.** Foundational. ~3-4 weeks.
- **NEW: 5.X — Situation Detection Layer.** Per source type. ~3-4 weeks each.
- **NEW: 5.X — Snippet Generation.** Per destination tool. ~3 days to 2 weeks each.
- **NEW: 5.X — Catalog Name Abstraction.** Per source type. ~2-4 weeks each.
- **NEW: 5.X — Connection Test.** Per source type. ~2-3 weeks each.
- **NEW: 5.X — Time-to-Access Operational Metric** (the Dehghani-gap measurement).
- **5.5 Anomaly Detection / 5.6 DX / 5.7 SOC 2:** unchanged in scope but slip with the rest.

OSR's tag-criteria for v0.1.0 changes from "engineer can clone-and-run" to "consumer can connect-and-use via tool of choice." Different milestone.

---

## Appendix A: Tonight's bug findings (filed)

**B-068 — Marketplace cross-org URL break.** Severity: High pre-PRD-reshape; likely Blocker post-reshape. B-061's `JwtAuthGuard` URL `:orgId === JWT orgId` check fires on legitimate marketplace cross-tenant reads. Fix candidates: (a) `@AllowCrossOrgRead` decorator on the marketplace controller's read endpoints, analogous to `@AllowNoOrg`; (b) restructure marketplace routes off `/organizations/:orgId/products/:id` onto `/marketplace/products/:id`. Lighter cut recommended for first PR.

**B-069 — `CONSUMPTION_GUIDANCE` template inverted UX.** Severity: Low-Medium. Static hardcoded placeholder map at `ProductDetailPage.tsx:29-39` renders above the dynamic `ConnectionDetailsPanel` (line 440+), causing top-to-bottom UX where the placeholder is read first. Should either be removed entirely or relegated to a clearly labeled "general guidance for [interface type]" beneath the real connection details. Post-reframe, the whole CONSUMPTION_GUIDANCE concept may be replaced by per-destination snippet generation; defer fix until PRD reshape lands.

**B-070 — Inbound-outbound bridge missing.** Severity: Pending PRD reshape, likely Blocker post-Sunday. `port_declarations` has no FK to `source_registrations` or `schema_snapshots`. Connector discovery (e.g., Databricks Unity Catalog crawl) writes metadata to `connectors.*` and `lineage.emission_log` but no service-level wiring populates `port_declarations.contract_schema` or `connection_details` from those sources. The two `null`-returning stubs in `ProductEnrichmentService` (`resolveColumnSchema`, `freshness.lastRefreshedAt`) are the surfacing symptoms. Promoted from "non-blocking stub" to "load-bearing gap."

---

## Appendix B: Why dev was 22 PRs behind

Discovered as a side-finding tonight: the deployed dev stack at `/opt/provenance` was on commit `58741b6` (2026-05-15) while the developer working tree at `/home/ec2-user/provenance` was on `e95ab93` (2026-05-22). 22 PRs across the 2026-05-21 (Databricks B-063) and 2026-05-22 (audit + frontend fixes) sessions never deployed to dev.

**Root cause:** `demo-sync.sh` exists for the demo box; no equivalent `dev-sync.sh` exists. Every dev redeploy is manual SSH-in + `git pull` + container rebuild. Recent sessions worked entirely against the working tree (clone, test, PR review) without touching `/opt/provenance`.

**Tonight's sync** (manually, after the consumer walkthrough surfaced the staleness): pulled to current main `dc35cfc`, rebuilt all 4 app containers, ran migrations V30 + V31, restarted stack, verified 14/14 containers healthy.

**Recommended follow-up:** write a `dev-sync.sh` analogous to `demo-sync.sh` (without the demo Caddy override; targeting `dev.provenancelogic.com`). Not urgent — could ride along with a future B-060 CI integration. Filed in head; not yet in the bug tracker.

---

## References

- [User story (Matt's original framing)](#the-user-story-matt-mcgarvey-2026-05-22) — embedded above.
- [Connector lift survey 2026-05-22](connector-lift-survey-2026-05-22.md) — peer doc, sized inbound engineering.
- [Claim-vs-code audit 2026-05-22](../audits/claim-vs-code-2026-05-22.md) — peer doc, established what's currently truthful.
- [ADR-010](adr/ADR-010-rls-by-default.md) — tenant isolation reframe (B-062). Untouched by this doc.
- [Bugs open](../bugs/open.md) — B-068, B-069, B-070 file targets.
- [Provenance Architecture v1.5](Provenance_Architecture_v1.5.md) — current architecture document. Section on outbound consumer flow will need substantial reshape in v1.6.
- [Provenance PRD v1.5](../prd/Provenance_PRD_v1.5.md) — current PRD. Domain 9 / Domain 10 / Phase 5 sections need overhaul per the framing above.
- Zhamak Dehghani, "Data Mesh" (2022) — third principle (self-serve infrastructure as a platform). The user story names this explicitly as the bar Provenance commits to, with the manual GRANT step as a named limitation to automate later.
