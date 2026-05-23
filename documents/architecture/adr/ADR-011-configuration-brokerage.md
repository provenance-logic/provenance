# ADR-011: Configuration Brokerage as the Consumer-Grade OSR Primitive

**Date:** May 23, 2026
**Status:** Accepted — anchors decisions 1 and 2 of `documents/architecture/prd-overhaul-anchor-decisions-2026-05-23.md`. The downstream decisions (3 through 6) inherit from this framing and are recorded in that document rather than here.
**Author:** Provenance Platform Team

---

## Resolves

Two related questions that the platform had not committed to architecturally before 2026-05-22:

1. **What is the OSR bar for the consumer experience?** Engineer-grade (consumer sees `connection_details` and figures it out) or consumer-grade (consumer clicks "Use this," picks a tool, gets connected)?
2. **What does the platform broker — configuration or credentials?** Configuration brokerage (platform brokers the configuration package; user supplies their own source-system identity) or credential brokerage (platform mints, holds, and rotates federated credentials per grant)?

Both questions were opened by the [2026-05-22 consumer-grade outbound reframe](../consumer-grade-outbound-reframe-2026-05-22.md) and settled in the [2026-05-23 anchor decisions session](../prd-overhaul-anchor-decisions-2026-05-23.md). This ADR records the architectural decisions; the anchor-decisions document records the broader decision tree (3 through 6) that flows from them.

---

## Context

The platform shipped through Phase 5 with a publication and consumption surface targeted at data engineers. A data product's connection details are stored as a JSON blob; the consumer of a product is expected to read the JSON, extract the host / port / credentials, and configure their own tool. This is the engineer-grade bar.

The 2026-04-18 walkthrough surfaced the gap obliquely (six fixes shipped under PRs #43–#47). The 2026-05-22 consumer-persona walkthrough surfaced it directly: a non-engineer can find a data product, can request access, can get access — and then cannot use it without help from a data engineer. The marketplace exists; the catalog page renders; the access flow works; the actual connection-to-data step requires expertise the platform's four-persona promise says the consumer should not need.

The reframe doc named the test: **the Power BI bar.** A non-engineer opens Power BI, clicks "Get Data → Provenance," picks a data product, lands connected. No JDBC literacy. No JSON parsing. No copy-paste of opaque strings.

The reframe doc also surfaced the credential-model question. Engineering effort had been tracking, implicitly, toward **credential brokerage** — the platform would eventually mint federated credentials per access grant, hold them, rotate them, expire them. Under that model the snippet given to the consumer would contain a credential the platform issued. The cost is months of per-source-type credential-broker infrastructure plus a fundamental change to what data lives where: secrets the platform mints land in the platform's control plane, which puts the platform on the data-plane edge of every connection. Constraint 3 (control plane and data plane are architecturally separated from day one) becomes load-bearing-by-omission rather than load-bearing-by-design.

The reframe sized an alternative: **configuration brokerage.** The platform brokers configuration — host, catalog name, snippet tailored to the consumer's tool of choice. The consumer supplies their own source-system identity (their existing Snowflake account, their existing Postgres role, their existing AWS principal). The snippet is a *config*, not a *credential*. Constraint 3 holds without strain. The lift drops from "months per source type forever" to "~3-4 months for a tight first cut."

The decision to take was: do both. Commit to consumer-grade as the OSR bar (so the platform's four-persona claim is load-bearing rather than aspirational), and pick configuration brokerage as the primitive (so the lift is achievable in the OSR timeline and Constraint 3 is preserved).

---

## Decision

### 1. Consumer-grade click-through is the OSR bar

The platform ships OSR when a non-engineer can land on a data product page in Provenance, pick a tool from a supported list (Python, SQL client, Power BI, Tableau, JDBC, dbt at MVP), receive a ready-to-use configuration snippet or download, and end up connected to the data — without writing JSON, parsing a JDBC URL, or asking a data engineer for help. The four personas (AI Agent, Domain Team, Data Consumer, Governance Member) all have first-class surfaces; none requires raw `connection_details` literacy.

Engineer-grade fallback is rejected as the OSR bar. It remains the fallback shape for source types where the consumer-grade primitives don't exist yet (see decision 5 in the anchor-decisions document) — but the marketing surface is honest about the gap rather than presenting the engineer-grade flow as the consumer-grade flow.

### 2. Configuration brokerage is the credential model

The platform brokers configuration — host, port (where applicable), catalog name, snippet for the consumer's tool of choice, optional connection-test reference. The platform does NOT mint, hold, proxy, or rotate user credentials against source systems. The consumer's authentication to the source is their own — their Snowflake account, their Postgres role, their AWS principal, their Databricks workspace identity, the OAuth flow their tool initiates natively against the source.

The output of the access flow is a working connection, not a credentials blob. "Working" means: configuration sufficient for the consumer's tool, addressed at the catalog-name layer, connected to the consumer's existing source-system identity. What the consumer copy-pastes is configuration (host + database + catalog name); what they type or are prompted for is their own credential.

### 3. The platform-issued artifact is the connection package, not a credential

The platform-issued artifact remains the **connection package** as defined by F10.8 and refined by [ADR-008](ADR-008-connection-reference-and-package-relationship.md). This ADR does not introduce a new primitive; it ratifies that the connection package is the operative artifact under the configuration-brokerage model and constrains its contents to *configuration only*, never credentials.

Lifecycle by principal type (unchanged from F10.8 / ADR-008):

- **Human consumer:** one connection package per active access grant. Per F10.8.
- **AI agent:** one connection package per active connection reference, with scope inherited from the reference. Per ADR-008. The access grant is the prerequisite, the connection reference is the per-use-case authorization, and the package is the usable artifact.

Contents this ADR commits to:

- The catalog name the consumer should reference (the user-facing primitive — anchor-decisions decision 6a).
- The source-system metadata the consumer's tool needs (host, database / catalog / schema where applicable, region, share name for native-share sources, etc.).
- Tool-specific snippets the consumer can paste or download. Snippets are generated lazily, on demand, per the consumer's destination-tool selection — matching the existing `ConnectionPackageService.generateSnippetForPort(...)` shape (PR #166). The "package" is the conceptual container; each snippet is generated when the consumer picks a tool.
- Optional: a `connection_test_reference` the consumer can invoke from Provenance to verify the configuration works against their own identity (anchor-decisions decision 6c).
- Provenance of the package: which authorization produced it (access grant for humans, connection reference for agents); the situation type — A, B, or C; expiration.

The connection package contains no credentials. Refresh and invalidation semantics remain as F10.10 / ADR-008 specify — regenerate on underlying connection-detail change, invalidate on revoke / expire / Suspended-reference transition.

### 4. The "manual GRANT" in Situation B is acknowledged as a known platform limitation

The consumer-grade user story names three situations the consumer can be in (A: already has product access via broad source-system grant; B: has source-system account but needs explicit per-product grant; C: no source-system account at all). Situation B's path includes a step where the product owner manually provisions the consumer's permission in the source system after approving the request in Provenance. This is a human bottleneck inconsistent with Dehghani's third principle (self-service infrastructure).

The platform names this gap explicitly in PRD v1.6 and surfaces it to operators as a measurable signal (time-to-access from owner approval to consumer connect). The roadmap commits to automating it over time as source-system identity integration matures — but this is **post-OSR work**, not in the OSR scope, and not in the scope of this ADR. Automating it is what would eventually require credential-broker-shaped infrastructure (a platform service account in each source system, with delegated identity authority). That infrastructure remains explicitly deferred.

### 5. Cross-org consumption uses native source-system primitives where they exist; "contact the owner" where they don't

The data mesh marketplace is cross-org by design. Cross-org consumption requires a source-system primitive that allows Org A's published product to be reached by Org B's identity. Where the source supports it natively (Snowflake data shares, Databricks Delta Sharing), the platform brokers the share metadata as part of the connection package and the consumer connects via their own account in their own Snowflake / Databricks workspace. Where the source supports it with friction (S3 bucket policies referencing external AWS principals), the same model applies with the friction acknowledged. Where the source has no native cross-org primitive (Postgres), cross-org consumption is "contact the owner" — Situation C — and the marketplace surface tells the consumer so honestly.

This is named here because it's a direct consequence of configuration brokerage: the platform cannot synthesize a cross-org primitive where the source doesn't have one. A credential-brokerage model could, in principle (the platform could maintain a service account in Org A's source and re-broker as Org B's principal), but configuration brokerage cannot. The trade is recognized.

---

## Why not the alternatives

### Option A — Stay engineer-grade

**Sketch.** Consumer sees `connection_details` JSON, copies values into their tool by hand, configures their own connection. The marketing surface is honest: "Provenance is a coordination and discovery platform for data engineers and AI agents; the consumer side assumes JDBC literacy."

**Cost.**

- The platform's four-persona claim becomes marketing copy without architectural backing. Consumer and Governance personas don't have first-class surfaces; they have "thin wrappers around the engineer surface."
- The 2026-05-22 persona walkthrough's central finding stands unaddressed: the platform's claims become *theoretically true* (defensible in a code walkthrough, invisible in a UI walkthrough).
- Data 3.0 framing weakens. The wedge is "AI agents as first-class participants alongside human domain teams, consumers, and governance boards" — if three of the four personas are engineer-grade and one (agents) is API-only, the "first-class participants" claim collapses.
- The platform competes with discovery / catalog tools (Atlan, Alation, Collibra, DataHub, Unity Catalog) in their natural shape (engineer-facing catalogs) rather than on its actual differentiation (AI-agent-native + consumer-grade for humans).

**Benefit.** Ships faster. OSR stays on its prior timeline; the six new consumer-grade workstreams don't get added to Phase 5.

**Verdict.** Rejected on the data mesh framing: a data mesh in which only data engineers can consume isn't a data mesh, it's a federated engineer's catalog. The framing has to mean what it says.

### Option B — Credential brokerage

**Sketch.** Per access grant, the platform mints a federated credential against the source system (e.g., a Snowflake service-account scoped key), holds it, rotates it, expires it on grant expiration. The connection package contains the credential the consumer pastes into their tool. The platform's UX-facing flow is uniform across sources; the friction in Situation B disappears (the GRANT is platform-issued, not manual).

**Cost.**

- **Per-source-type integration is months, not weeks.** Each source has its own identity primitive (Snowflake service accounts + OAuth, Databricks PAT generation, AWS IAM access keys, Postgres roles, etc.). Each needs its own credential-mint + rotation + revoke implementation. Estimated 6+ weeks per source on top of the inbound-outbound lift.
- **Constraint 3 erodes.** The platform now holds secrets that grant access to user data. Loss-of-secret incidents become platform-incidents in the sense that the platform's security posture is on the line for data it does not host. Auditors will ask: how does the platform's SOC 2 boundary contain credentials issued against systems outside its control plane?
- **Cross-org becomes deeply platform-coupled.** For Org B to consume Org A's product via a platform-issued credential, the credential is minted in Org A's source by a platform service account, then handed to Org B's consumer. The platform sits on the data-plane edge of every cross-org consumption.
- **The "automate the manual GRANT" outcome is achievable without going all-in.** Configuration brokerage can evolve toward partial automation (e.g., a platform-issued GRANT-on-behalf-of-owner workflow that runs in the owner's source via a delegated principal) without making credentials a platform-held primitive.

**Benefit.** Situation B's UX-friction disappears. The four-persona promise is more easily defensible because the consumer never sees a credential prompt of any kind. Cross-org consumption works uniformly.

**Verdict.** Rejected for OSR. The cost is months of credential-broker infrastructure across N source types, and the cost is incurred indefinitely (every new source adds another credential broker). The Constraint 3 erosion is the load-bearing rejection — the platform's whole architectural posture is "control plane stores contracts; data plane stays in the domain." Credential brokerage puts the platform on the data plane in a way that does not blur cleanly back.

### Option C — Partial: credential-broker some sources, configuration-broker others

**Sketch.** Sources with simple credential primitives (e.g., Postgres roles) are credential-brokered. Sources with native cross-org primitives (Snowflake, Databricks) are configuration-brokered. The platform picks per source type.

**Cost.** Worst of both worlds. Some sources put the platform on the data plane; some don't. The four-persona claim is uniform only across the configuration-brokered subset. The Constraint 3 story becomes "control plane stores contracts and, for sources X / Y / Z, also stores credentials" — a footnote rather than an axiom. Documentation cost compounds; operators must learn which sources are which model.

**Benefit.** Some sources get Situation-B-friction-free flows.

**Verdict.** Rejected. The architectural simplicity of "configuration only, full stop" is worth more than the per-source UX gain. The friction in Situation B is named honestly and committed to be automated over time, but it's named the same way across all sources rather than fractured per source type.

---

## Consequences

### Positive

- **Constraint 3 holds without strain.** The control-plane / data-plane boundary is preserved. The platform's SOC 2 boundary is the platform; the consumer's source-system credentials remain in the consumer's IDP / tool / source.
- **The four-persona promise becomes architecturally load-bearing.** Each persona gets a first-class surface in PRD v1.6, with consumer-grade as the design constraint for the Data Consumer surface specifically.
- **The cross-org marketplace is real where the source supports it natively.** Snowflake / Databricks Delta Sharing become real consumption primitives, not just metadata-listing primitives.
- **The lift is sized at ~3-4 months tight for a first cut**, not "months per source type forever." OSR is reachable in 2026 calendar year.
- **Honest acknowledgement of the Dehghani gap.** Situation B's manual GRANT is named as a known limitation rather than papered over. Auditors and customers will respect this; pretending the gap doesn't exist gets caught later.
- **Per-source-type cost stays bounded.** New source = inbound (probe + schema + discovery) + outbound (situation detection + snippet templates per supported destination) + catalog-name abstraction + connection-test. No new credential-broker infrastructure. Estimated 6-8 weeks per source at the consumer-grade bar versus 3+ months for credential-brokered.

### Negative

- **Situation B carries friction at OSR.** The owner-provisions-permission step is manual. The consumer's "time to first byte" is dominated by the owner's response SLA, which is governance-policy-determined and outside the platform's control. The platform surfaces this as an operational metric but does not fix it for OSR.
- **OSR target slips.** Roughly ~Q4-2026 instead of the prior vague Q3-2026. Six new workstreams added to Phase 5; the previously-planned Phase 5 items (anomaly detection, SOC 2 foundations, developer-experience tail) are re-evaluated against the new scope.
- **Cross-org consumption is not uniform across source types.** Postgres has no cross-org primitive; the marketplace surface for PG products tells the consumer so. This is honest but it asymmetric in a way that may surprise reviewers.
- **The connector enum is reset.** B-063's Option-3-plus-4 (anchor-decisions doc decision 5) means PG + S3 + Databricks now; Snowflake next; everything else deferred. The "12 connector types" claim that existed at Phase 3 completion is retired in favor of "the types that actually work, and a roadmap for adding more."

### Neutral

- **Streaming, REST, and custom connectors are deferred entirely.** Their A/B/C user story doesn't map cleanly; they need their own story before they can ship. Tracked in the deferred list of the anchor-decisions document.
- **CLAUDE.md gets new architectural rules.** The "configuration brokerage, not credential brokerage" framing becomes a non-negotiable. Adjacent rules (Constraint 3 reinforcement, secrets-never-platform-stored) update to reflect the explicit commitment.

---

## Implementation notes (for downstream work)

These notes name the work this ADR triggers; per-area design happens in follow-up ADRs or PRD-section reviews, not here.

1. **PRD v1.6 restructure.** Reorganize around the four personas with consumer-grade as the design constraint for the Data Consumer chapter. The credential-model chapter (or appendix) distills this ADR into PRD prose so the PRD stands as the primary product reference and the ADR stands as the architectural record.
2. **Phase 5 reshape.** Six new workstreams: inbound-outbound bridge (decision 4 in the anchor doc), situation detection (decision 6c), six-destination snippet generator, catalog-name abstraction (decision 6a), connection-test layer, credential-lifespan UX (grant-side TTL warnings + renewal). Existing Phase 5 items (anomaly detection, SOC 2 foundations, dev-experience tail) are re-evaluated against these; some merge into the new workstreams, some defer to Phase 6.
3. **CLAUDE.md updates.** A new "Configuration brokerage, not credential brokerage" architectural rule. A new "The connection package (per F10.8 / [ADR-008](ADR-008-connection-reference-and-package-relationship.md)) is the user-facing artifact and contains configuration only — never credentials" rule. Reinforcement of the Constraint 3 language to call out that this ADR is the operative commitment that keeps Constraint 3 unblurred.
4. **B-070 schema change as the first concrete enabling work.** The single FK from `port_declarations` to `source_registrations` plus the `source_object_path` column is what makes "discovery initializes port" possible — which is what makes consumer-grade producer publishing possible. Sequencing: B-070 ships first; the snippet generator, catalog-name views, and situation detection build on top.
5. **The Snowflake addition as the first new consumer-grade-bar source.** PG + S3 + Databricks are first-class today (B-063 anchor-decision 5). Snowflake is the next add at the new bar — ~6-8 weeks, includes probe + schema + discovery + situation detection + snippets + catalog-name views + cross-org-via-shares.
6. **Operational metric: time-to-access.** Measured from owner-approval timestamp to first successful connection-test by the consumer. This is the metric that names the Dehghani gap; surfacing it operationally is what keeps the "known platform limitation" honest over time.

---

## Open questions deferred

These are settled at the framing level by this ADR but have downstream design decisions worth naming. Pulled from the anchor-decisions document's aggregate deferred list, filtered to items that interact directly with the configuration-brokerage commitment:

- **Notification cross-org routing.** When an Org A consumer's request fires a notification to an Org B owner, which org's notification queue owns the row? Not settled by any of the access-request ownership models (A/B/C); separate downstream decision. (Anchor-decisions decision 3.)
- **DDL generation for catalog-name views.** Source-side views are the chosen mechanism for PG / Snowflake / Databricks (anchor-decisions 6a). Whether the platform auto-generates the `CREATE VIEW` DDL, offers a copy-paste, or asks the producer to author it manually is UX work, not architectural.
- **Source-system directory integration for situation detection.** Layered detection (anchor-decisions 6c) defers directory integration to post-OSR. When that work lands, it will require platform-side credentials to the source's identity primitive — which is the credential-broker-shaped infrastructure this ADR otherwise excludes. The path to that capability needs its own ADR when the work is scheduled.
- **Automated source-system credential federation.** The eventual automation of Situation B's manual GRANT. By definition this is credential-broker-adjacent. It is excluded from OSR but is a candidate for a future ADR — likely "ADR-NN: Source-system service-account integration for delegated GRANT-on-behalf-of-owner."
- **Streaming / REST / custom connector story shape.** Their A/B/C trichotomy doesn't map cleanly. Each needs its own user story before its connector implementation can ship. (Anchor-decisions decision 5.)

---

## References

- [Consumer-grade outbound reframe (2026-05-22)](../consumer-grade-outbound-reframe-2026-05-22.md) — the user story and the five open questions that surfaced this decision.
- [PRD overhaul anchor decisions (2026-05-23)](../prd-overhaul-anchor-decisions-2026-05-23.md) — the full decision tree (1 through 6). This ADR distills decisions 1 and 2; the rest live in the anchor-decisions document.
- [Connector lift survey (2026-05-22)](../connector-lift-survey-2026-05-22.md) — inbound sizing input.
- [B-063](../../bugs/open.md#B-063) — connector framework register-only; constrained by anchor-decisions decision 5.
- [B-070](../../bugs/open.md#B-070) — inbound-outbound bridge missing; constrained by anchor-decisions decision 4.
- [B-071](../../bugs/open.md#B-071) — cross-org access requests structurally broken; constrained by anchor-decisions decision 3.
- [ADR-008 — Connection reference and package relationship](ADR-008-connection-reference-and-package-relationship.md) — defines the connection-package primitive this ADR ratifies as configuration-only; lifecycle, refresh, invalidation semantics unchanged.
- [ADR-010 — RLS by default](ADR-010-rls-by-default.md) — the tenant-isolation discipline this ADR's downstream decisions must preserve.
- [Provenance Architecture v1.5](../Provenance_Architecture_v1.5.md) — Section on the five non-negotiable constraints; this ADR commits to Constraint 3's interpretation explicitly.
- `documents/prd/Provenance_PRD_v1.5.md` — current PRD; v1.6 overhaul cites this ADR as the framing anchor.
