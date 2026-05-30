# Demo Asset Inventory

A factual, grounded reference for what *exists* on the seeded demo environment right now. Use this as the input to a demo script — it tells you which orgs, products, agents, lineage edges, policies, and *live signals* are sitting on the demo box, ready to be clicked through.

This file does **not** prescribe a narrative or tone. That's the layer you'd take into Claude.ai or a co-founder review. This file is the underlying ground truth.

**Source of truth for everything below:** `packages/seed/src/`. If the seed changes, this file is stale — regenerate from current main.

**Demo URL:** https://demo.provenancelogic.com. Everyone below logs in with password `DemoPass123!`.

> **Inventory currency note (2026-05-30).** Last substantive refresh against the seed: 2026-05-30. Sections 5 (agents grants+refs), 8 (counts), 9 (MCP tool×product matrix), and 11 (rough edges) reflect PR #226 which added the agent-grants + connection-references seed shape. Pre-2026-05-30 rehearsal-bug callouts (B-054/55/56/57/58, all ✅ fixed) have been removed; if you want the history of those, see `documents/bugs/resolved.md`.

---

## 0. Demo setup (before the live walk)

A few things that are not bugs but bite the first time:

**Multi-persona switching needs separate browser contexts.** Keycloak uses a domain-scoped session cookie. Logging in as a new persona in *any* tab logs *all* tabs into that persona. The "have three tabs open with three personas" mental model doesn't work in a single browser window. Three options, recommended first:

1. **Chrome profiles (recommended).** Create one named Chrome profile per persona you'll demo (e.g. "Maya — Marketing", "Aiden — Analyst", "Gita — Governance"). Each profile keeps its own cookies. Log in once per profile, bookmark the starting URL. Persona-switching during the demo becomes a taskbar click.
2. **Separate browsers.** Chrome + Firefox + Safari, one persona each. Works in a pinch.
3. **Separate incognito / private windows.** Chrome incognito windows have isolated sessions per *window* (not per tab). Safari private windows share state across private windows — only one Safari private window at a time. Use Chrome incognito or Firefox private windows for this.

**Have the demo box started before the demo.** Cold-start from `aws ec2 start-instances` takes ~2 min. Land the prep before audience joins.

**Verify the state is pristine** before each new demo. The signals in Section 6 (unread notifications, pending requests) get *consumed* by walking the demo, so a clean state matters for the second rehearsal. Soft reset (`bash infrastructure/scripts/demo-reset.sh` without `--hard`) is the routine between-rehearsals path.

**Hard reset is now safe** once PR #234 (B-078 + B-085) is deployed to the box. Before that fix `--hard` (a) truncated `flyway_schema_history` so the api wouldn't boot on the next container recreate (B-078) and (b) wasn't repeatable on an already-seeded box — orphaned Keycloak agent clients 500'd `/seed/agents` (B-085). Both are fixed in #234 (`createAgentClient` deletes-then-recreates; `flyway_schema_history` no longer truncated; `consent`/`notifications` schemas now cleared). The box was hard-reset + reseeded clean on 2026-05-30 (flyway history repaired). If you hard-reset a box still on pre-#234 code, recovery is `DROP TABLE organizations.flyway_schema_history;` → `flyway baseline -baselineVersion=<latest>` → restart api, plus deleting the `agent-acme-marketing-copilot` / `agent-beta-risk-assistant` Keycloak clients before reseeding.

---

## 1. Orgs

Two seeded tenants, both running in the same demo instance with full multi-tenant isolation:

| Slug | Name | Industry | Domains | Demo angle |
|---|---|---|---|---|
| `acme-corp` | Acme Corporation | Consumer goods manufacturer | Marketing, Supply Chain, Finance | The "classic data mesh" story — three independent domain teams, shared SLO discipline, cross-domain consumers |
| `beta-industries` | Beta Industries | Fintech / regulated | Risk, Customer | The "compliance-and-agents" story — KYC + PCI scope, agent trust classifications, regulator-flavored audit |

Use Acme for general-audience walkthroughs; switch to Beta when you want to lean on regulated/agent narratives.

---

## 2. People (Keycloak users)

11 seeded users, password `DemoPass123!` for all. Each one is the right lens for a different demo angle:

### Acme Corporation (6 users)

| Email | Display name | Role | Use this login when you want to show... |
|---|---|---|---|
| `admin@acme.example.com` | Ada Admin | `org_admin` | Org-level admin view: members, roles, settings, governance config |
| `marketing-lead@acme.example.com` | Maya Rodriguez | `domain_owner` (marketing) | A domain owner's experience: authoring Customer 360 + Campaign Attribution, reviewing access requests against their own products, SLO violations on Campaign Attribution |
| `supply-lead@acme.example.com` | Samuel Okafor | `domain_owner` (supply-chain) | Domain owner whose product just tripped an SLO (Daily Inventory Snapshot freshness) |
| `finance-lead@acme.example.com` | Fatima Lindgren | `domain_owner` (finance) | The compliance-flavored finance lens; sees a trust-score drop on Daily Revenue Recognition |
| `analyst@acme.example.com` | Aiden Chen | `consumer` | A pure consumer — has approved grants to Customer 360 + Revenue Daily + Supplier Performance, one expiring grant, pending requests, an approval-notification trail |
| `governance@acme.example.com` | Gita Schreiber | `governance` | The governance angle: compliance drift on Customer 360, classification change on Marketing Copilot, cross-domain visibility |

### Beta Industries (5 users)

| Email | Display name | Role | Use this login when you want to show... |
|---|---|---|---|
| `admin@beta.example.com` | Beatriz Admin | `org_admin` | Beta tenant admin view |
| `risk-lead@beta.example.com` | Raj Patel | `domain_owner` (risk) | The risk domain — three streaming and batch products, includes the credit decisions product with rationale |
| `customer-lead@beta.example.com` | Camille Okonkwo | `domain_owner` (customer) | The KYC product owner — has approval workflows for PCI-scoped requests |
| `compliance@beta.example.com` | Carlos Nguyen | `governance` | Beta's compliance angle; oversight contact for the Risk Assistant agent |
| `analyst@beta.example.com` | Anya Volkov | `consumer` | Has an approved grant to KYC profiles, a pending request on Credit Risk Decisions |

### Quick login matrix for common demo angles

| If you want to show... | Log in as |
|---|---|
| The "data product owner's life" | `marketing-lead@acme.example.com` |
| The "data consumer trying to discover and request" | `analyst@acme.example.com` |
| Governance + compliance + drift detection | `governance@acme.example.com` |
| Regulated tenant / PCI / agent oversight | `compliance@beta.example.com` |
| Cross-org admin view | `admin@acme.example.com` or `admin@beta.example.com` |

---

## 3. Data products (10 seeded, all `published`)

### Acme Corp (6 products)

| Product | Domain | Owner | Freshness SLA | Ports | Tags | Demo angle |
|---|---|---|---|---|---|---|
| Customer 360 | Marketing | Maya | 24h | SQL/JDBC + Semantic (MCP) | customer, **pii**, gold | The flagship — has *both* a SQL port (for humans) and a semantic MCP port (for agents). PII-tagged → policy hits |
| Campaign Attribution | Marketing | Maya | 12h | REST | marketing, attribution | Currently **in SLO violation** (p95 latency 742ms vs 500ms threshold) |
| Daily Inventory Snapshot | Supply Chain | Samuel | 24h | SQL/JDBC | supply-chain, inventory | Currently **in SLO violation** (snapshot freshness 11.4h vs 8h threshold) |
| Supplier Performance | Supply Chain | Samuel | 7d | REST | supply-chain, suppliers | Healthy product; good example of weekly cadence |
| Daily Revenue Recognition | Finance | Fatima | 24h | SQL/JDBC | finance, revenue, **sox-relevant** | **Trust score just dropped 0.91 → 0.78** (reconciliation failed SLO twice this week). Best "the platform tells you something is wrong" moment |
| Weekly Revenue Forecast | Finance | Fatima | 7d | GraphQL | finance, forecast | Shows GraphQL interface in the connection details |

### Beta Industries (4 products)

| Product | Domain | Owner | Freshness SLA | Ports | Tags | Demo angle |
|---|---|---|---|---|---|---|
| KYC Profiles | Customer | Camille | 1h | REST (with mTLS note) | customer, kyc, pii, **pci-scope** | Most regulated product — PCI tag triggers `beta.pci-scope-isolation` policy. Approved access for analyst@beta |
| Transaction Risk Signals | Risk | Raj | 5m | Streaming (Kafka) | risk, streaming, pci-scope | Shows the streaming/Kafka interface; sub-minute SLA |
| Credit Risk Decisions | Risk | Raj | 24h | SQL/JDBC | risk, credit, explainable | Shows the "decisions + rationale" pattern; pending request from analyst@beta |
| Account Lifecycle Events | Customer | Camille | 1h | Streaming (Kafka) | customer, events | Append-only log pattern |

### What this catalog gives you for demos

- **Five port interface types covered:** SQL/JDBC, REST, GraphQL, Streaming (Kafka), Semantic (MCP). Picks the right interface for whatever audience you're talking to.
- **Three lifecycle realities:** all 10 are Published right now, but the lifecycle UI exists (Draft / Published / Deprecated / Decommissioned) — note this when explaining the model.
- **Two active SLO violations and one trust-score drop seeded in** — see Section 6.

---

## 4. Lineage graph (8 seeded edges)

The Lineage Explorer shows this small but realistic DAG when you open any of the seeded products and click the "Lineage" tab. React Flow + Dagre auto-layout, deterministic LR.

**Acme side:**
- `customer-360` → `campaign-attribution` (derives_from)
- `customer-360` → `revenue-daily` (depends_on)
- `inventory-daily` → `supplier-performance` (derives_from)
- `inventory-daily` → `revenue-daily` (depends_on)
- `revenue-daily` → `forecast-weekly` (derives_from)

**Beta side:**
- `account-lifecycle-events` → `transaction-risk-signals` (depends_on)
- `kyc-profiles` → `credit-risk-decisions` (depends_on)
- `transaction-risk-signals` → `credit-risk-decisions` (consumes)

**Demo angle.** Open `revenue-daily` → Lineage tab. You see five nodes: customer-360 + inventory-daily upstream, forecast-weekly downstream. Click any of them to navigate. This is the "data mesh is a *graph*, not a list" visual moment.

---

## 5. Agents (2 seeded)

| Agent | Org | Trust classification | Oversight contact | Active grants + refs | Notable |
|---|---|---|---|---|---|
| Marketing Copilot | Acme Corp | `observed` | marketing-lead@acme.example.com | Customer 360 (discovery+observability, 180d), Daily Revenue Recognition (discovery+observability, 90d) | A `classification_changed` notification is seeded against `governance@acme` (observed → supervised, with reason). **The agent's current classification is still `observed`** — the notification is a seeded *signal*, not a real history entry. Don't click through expecting to see a "Supervised" current classification or a multi-row Classification History; you'll see "Observed" and one initial entry. Use the notification as a "platform tells you when state has changed" beat; don't drill into the agent for narrative continuity. Broad-scope refs let the full product-bound MCP tool surface work — that's the real Marketing Copilot demo arc. |
| Risk Assistant | Beta Industries | `observed` | compliance@beta.example.com | Credit Risk Decisions (**discovery ONLY**, 30d) | Held at Observed by `beta.risk-domain-observed-only` policy. **Discovery-only scope is deliberate** — drives the `CONNECTION_REFERENCE_SCOPE_VIOLATION` demo when `get_trust_score` (observability scope) is called on the same product |

**Demo angle.** Open the agent registry. Both agents have JWT-based authentication (ADR-002). The Marketing Copilot has a classification-change audit trail you can show. The Risk Assistant's "stuck at Observed by policy" is the right hook for the federated governance story.

**The agents have *meaningful* grants + connection references** (seeded 2026-05-30) — they are not skeleton identities. See Section 9 for the exact tool×product map.

---

## 6. Live signals seeded into the demo (the most underrated demo asset)

This is what makes the demo feel *alive* — open the right login and there's already an interesting signal demanding attention.

> **All notification deep-links now resolve to real routes** (B-083, fixed 2026-05-30). The deep-link paths quoted below are the *authored* slug forms; at runtime the seed rewrites them to concrete UUID routes, so clicking any notification lands correctly. In particular the finance-lead trust-score notification — previously an **Internal Server Error** — now lands on the Daily Revenue Recognition product page.

### As `governance@acme.example.com`
- **Compliance drift detected** on Customer 360 — PII completeness at 93.2% vs 95% policy floor. Deep links to `/governance/compliance`.
- **Trust score significant change** on Daily Revenue Recognition — dropped from 0.91 to 0.78. Same signal `finance-lead` sees, fanned out to governance because material trust regressions are governance-relevant across all domains. Deep links to `/marketplace/revenue-daily/trust`.
- **Classification changed** for Marketing Copilot (observed → supervised). Already read but in history. Deep links to `/agents/marketing-copilot`. *Caveat: this is a seeded notification only — the agent's current classification is still `observed` and the Classification History tab shows only the initial Observed entry. The notification is a "platform surfaces state-changes" beat; don't deep-link into the agent expecting to see the change.*

### As `finance-lead@acme.example.com`
- **Trust score significant change** on Daily Revenue Recognition — dropped from 0.91 to 0.78. Reason: reconciliation match rate fell below 99.5% SLO floor twice this week. Deep links to `/marketplace/revenue-daily/trust`. **This is the strongest single moment in the demo for "the platform tells you something is wrong before you ask."**
- **Pending access request** from Samuel Okafor (supply-lead) wanting to reconcile inventory write-offs against revenue postings.

### As `marketing-lead@acme.example.com`
- **SLO violation** on Campaign Attribution — p95 latency 742ms vs 500ms threshold. Deep links to `/publishing/campaign-attribution/observability`.
- A **read** `access_request_submitted` notification from Aiden Chen (Customer 360, 30 days ago) sits in history. ⚠️ This is *not* a live pending request — analyst already holds an approved Customer 360 grant. The owner's live approval beat is driven by submitting a fresh request during the demo (see Section 8 / Audience A): analyst requests **Campaign Attribution** (the one Acme product analyst has no grant on, owned by marketing-lead), and marketing-lead approves it live.

### As `supply-lead@acme.example.com`
- **SLO violation** on Daily Inventory Snapshot — freshness lag 11.4 hours vs 8 hour threshold. Deep links to `/publishing/inventory-daily/observability`.

### As `analyst@acme.example.com`
- **Access grant expiring** on Supplier Performance — 7 days out.
- Approved-and-read trail on Customer 360 from 30 days ago.

### As `customer-lead@beta.example.com` and `compliance@beta.example.com`
Beta seed has similar patterns (access requests, SLO signals, KYC-related notifications) — see `packages/seed/src/notifications/beta-industries-notifications.ts`.

---

## 7. Governance policies (6 seeded, all OPA Rego)

Visible in the Policy Studio when logged in as `governance@acme.example.com` or `compliance@beta.example.com`.

| Org | Policy key | Scope | Plain-English summary |
|---|---|---|---|
| acme-corp | `acme.pii-requires-governance-approval` | platform | PII-tagged ports need governance approval before access is granted |
| acme-corp | `acme.supply-chain-autonomous-blocked` | domain | Autonomous agents can't consume supply-chain products at all |
| acme-corp | `acme.freshness-sla-on-publish` | product | Can't publish a product without a declared freshness SLA |
| beta-industries | `beta.pci-scope-isolation` | platform | PCI-scoped ports only consumable by PCI-cleared principals |
| beta-industries | `beta.risk-domain-observed-only` | domain | Risk-domain products require Observed agents (governance grant required for higher classification) |
| beta-industries | `beta.kyc-retention-90d` | product | KYC ports must cap output to 90 days of retention |

**Demo angle.** These are real Rego — open one in the Policy Studio and you can read the actual policy body. The "policy as code, enforced automatically" claim is provable in 90 seconds.

---

## 8. Access requests + grants + connection references (the workflow surface)

- **10 access grants** seeded across both orgs — 7 human grants (3 active and healthy, 1 expiring on Acme, 3 on Beta with one expiring in 5 days) plus 3 agent grants added by PR #226 (Marketing Copilot on customer-360 + revenue-daily, Risk Assistant on credit-risk-decisions).
- **5 access requests** in various states — 3 pending (each one a "click this to approve" moment), 1 approved with history, 1 denied with rationale.
- **3 active connection references** (Domain 12, added by PR #226) — paired with the 3 agent grants. Two broad-scope (Marketing Copilot, discovery+observability), one tight-scope (Risk Assistant, discovery only — drives the violation beat in Section 9).

Best human demo flow (the **live request→approve loop**): as `analyst@acme.example.com`, open **Campaign Attribution** → **Request Access** → submit (analyst has no grant on this product, so the button is present; the three products analyst *does* hold grants on — Customer 360, Revenue Daily, Supplier Performance — won't show a Request Access button). Then switch to the owner `marketing-lead@acme.example.com` → **Access Requests** (or the notification) → Approve. Switch back to analyst → the **connection package** is now visible with real curl / JDBC / Python snippets (B-084, fixed 2026-05-30 — snippets render for every interface type now). One coherent flow across both personas; the approver's queue fills *during* the demo rather than relying on a pre-seeded request.

---

## 9. The MCP / agent surface

Phase 4 is live. From any agent-registered Keycloak client (the two seeded ones above), the MCP SSE endpoint at `https://demo.provenancelogic.com/mcp/sse` (or port 3002 direct on the dev box) exposes 9 tools: `list_products`, `get_product`, `get_trust_score`, `get_lineage`, `get_slo_summary`, `search_products`, `semantic_search`, `register_agent`, `get_agent_status`.

**Five tools are exempt from the Domain 12 guard** (`tool-scope-map.ts`): `list_products`, `search_products`, `semantic_search`, `register_agent`, `get_agent_status`. They work for any authenticated agent with no per-product authorization. **Four tools are product-bound:** `get_product` + `get_lineage` (discovery scope), `get_trust_score` + `get_slo_summary` (observability scope). Each requires both an active access grant AND an active connection reference whose `approvedScope.ports` covers the tool's port.

### Tool × product matrix for the seeded agents

| Agent | Product | Tool | Expected outcome | Reason |
|---|---|---|---|---|
| Marketing Copilot | (any) | `list_products`, `search_products`, `semantic_search` | ✅ returns data | Exempt tools |
| Marketing Copilot | customer-360 | `get_product`, `get_lineage`, `get_trust_score`, `get_slo_summary` | ✅ returns data | Active grant + active ref scoped to discovery + observability |
| Marketing Copilot | revenue-daily | `get_product`, `get_lineage`, `get_trust_score`, `get_slo_summary` | ✅ returns data | Active grant + active ref scoped to discovery + observability |
| Marketing Copilot | (other Acme products) | any product-bound tool | ❌ `ACCESS_GRANT_NOT_FOUND` | No grant for this product |
| Risk Assistant | (any) | exempt tools | ✅ returns data | Exempt tools |
| Risk Assistant | credit-risk-decisions | `get_product`, `get_lineage` | ✅ returns data | Discovery is in approved scope |
| Risk Assistant | credit-risk-decisions | `get_trust_score`, `get_slo_summary` | ❌ **`CONNECTION_REFERENCE_SCOPE_VIOLATION`** | Observability is NOT in approved scope (deliberate, demo beat) |
| Risk Assistant | (other Beta products) | any product-bound tool | ❌ `ACCESS_GRANT_NOT_FOUND` | No grant for this product |

**The scope-violation row is the demo's "watch it actually enforce" moment.** Same agent, same product, different tool — and the platform denies because the per-use-case scope says so. Audit row written. Notification fans out to the approver (`compliance@beta.example.com`) plus every governance-role principal in the org.

**Demo angle.** If your audience is technical, do a live MCP tool call from Claude Code or a sample MCP CLI. The "human-discoverable AND agent-discoverable, governed identically" claim becomes tangible — and for the governance-flavored audience, the scope-violation beat makes it visceral.

**Caveat:** the connection-details `endpoint` strings on the products refer to *fictional* hosts (`warehouse.acme.example.com`, `api.beta.example.com`, etc.). Those are illustrative — don't actually click the example client commands expecting them to reach a backing store. The MCP tools themselves *are* real and return real data from the seeded product catalog.

---

## 10. Per-audience skeleton click paths

These are *skeletons* — bullet points that mark out the shape of a walk. Take them into Claude.ai for narrative dressing.

### Audience A: Investor / non-technical (10 min)

The story is "**this is a coordination platform for the AI-agent era.**" Show, don't explain.

1. **Open marketplace** as `analyst@acme.example.com` (a non-owner consumer). One screen: 10 products across two orgs, with trust scores, owners, lifecycle states, freshness SLAs. *"This is what data looks like when it's a *product*, not a table."*
2. **Click Customer 360** → show schema + ownership + lineage tab + trust score breakdown. *"Every product has a contract, an owner, a service level."* (Analyst already has a grant here, so its Ports tab shows live connection snippets — good for the contract story, but use a different product for the *request* beat below.)
3. **Open Campaign Attribution → click "Request Access."** Show the request form. Submit. *"Self-serve, not a Jira ticket."* (Campaign Attribution is the one Acme product analyst has no grant on — so the Request Access button is present. Customer 360 / Revenue Daily / Supplier Performance already have grants and won't show it.)
4. **Switch login to `marketing-lead@acme.example.com`** (the owner of Campaign Attribution). Open **Access Requests** in the left nav (or click the notification — deep-links resolve correctly now). The request you just submitted is at the top with inline Approve / Deny actions. Click Approve, confirm in the dialog. *"The compliant path is the easy path — and every approval is an explicit, audited gesture."*
5. **Switch back to analyst.** Now the connection package is visible — JDBC URL, curl snippet, Python snippet, MCP integration guide (snippets render for every interface type, B-084 fixed). *"Approved means *usable*, not 'wait three days for IT.'"*
6. **Open the Agent Registry** (one click). Show the two registered agents with trust classifications. *"And it works the same way for AI agents. Same governance, same audit, same trust contract."*
7. **Click Marketing Copilot.** Detail page loads with four tabs: Overview, Access Grants, Connection References, Classification History. The **Connection References tab now shows two active references** (customer-360, revenue-daily — seeded by PR #226). *"Every agent action is provenanced — same word the company is named for. The Connection References tab is the Domain 12 surface: per-use-case consent records governing what this agent can do, with what data, for how long."* ⚠️ The Classification History tab shows only the initial Observed entry — don't promise a visible observed→supervised transition (the seeded notification is a synthetic signal; see Section 5 caveat).
8. **Open `governance@acme.example.com`.** Two governance-relevant signals are already waiting: the **compliance drift** on Customer 360 (PII completeness below policy floor) and the **trust-score drop** on Daily Revenue Recognition (0.91 → 0.78, reconciliation match rate breached SLO twice this week). *"And the platform tells you when something is wrong before you ask — both compliance regressions and trust regressions surface in the governance lens without anyone having to go look."*

**What to avoid:** Don't show the dev-mode URL bar (port 3000 etc.). Don't say "this is built on Kubernetes" — it's not, yet. The architecture story is *the right one for production*; the current MVP is Docker Compose on EC2 and that's fine.

### Audience B: Technical colleague / data architect (15 min)

The story is "**we made all the right architecture calls and there's evidence of each one in the running stack.**"

1. **Open the Lineage Explorer** on `revenue-daily`. Show the DAG. *"Native graph database for the lineage layer (Neo4j) — arbitrary-depth traversal is the wrong shape for relational, here's why."*
2. **Click any upstream node.** Show navigation. *"Time travel is on the roadmap (F5.17), not yet shipped — but the data model already supports it."*
3. **Open the Policy Studio.** Show one of the seeded OPA policies — `beta.pci-scope-isolation` is a good one. *"Governance is computational, not procedural. This is real Rego, hot-reloadable, enforced at request time."*
4. **Show the Compliance Monitor.** Drift detection on Customer 360 with the 93.2% vs 95% number. *"Drift detection runs continuously; products move through Compliant / Drift Detected / Grace Period / Non-Compliant automatically."*
5. **Open the API docs at `/api/v1/docs`.** OpenAPI 3.1 rendered live, source-of-truth specs in `packages/openapi/`. *"Every API surface in the platform is spec-first."*
6. **Live MCP demo.** From your terminal, hit the MCP server as Marketing Copilot and call `list_products` then `get_trust_score` with `product_id` for customer-360. *"Agents are first-class. Same JWTs, same row-level-security, same audit log."* **For the violation beat:** also exchange a Risk Assistant JWT and call `get_trust_score` against credit-risk-decisions — denied with a structured `CONNECTION_REFERENCE_SCOPE_VIOLATION` because the seeded reference is discovery-only. Both verified end-to-end on the demo box 2026-05-30. ⚠️ **Don't call `get_product` from the CLI** — B-082 (filed 2026-05-30): it requires `domain_id` and returns 500 if omitted. Stick to the three other product-bound tools (`get_trust_score`, `get_lineage`, `get_slo_summary`) which only need `product_id`.
7. **Open the Agent Detail page** for Marketing Copilot. Show the trust classification, the oversight contact, the audit trail. *"Three trust tiers — Observed, Supervised, Autonomous. Autonomous can never be set programmatically; only a governance role can promote."*
8. **The persistence story for connection references.** Mention Domain 12 (ADR-005 through ADR-008) — "every agent action requires both an active access grant AND an active connection reference with use-case scope." Don't deep-dive unless they ask.

**What to lean into:** the five non-negotiables in `CLAUDE.md` (native graph, hot-reloadable policy engine, control-plane/data-plane separation, distinct agent query layer, native MCP). Each one is visible somewhere in the running stack. Show, point, move on.

### Audience C: Governance / compliance officer (12 min)

The story is "**we made your job a software problem.**"

1. **Log in as `governance@acme.example.com`.** Notification center shows compliance drift + classification change. *"Continuous compliance monitoring is how the platform's day starts."*
2. **Click into the drift on Customer 360.** Show what triggered it (PII completeness 93.2% vs 95% floor). *"The threshold is yours, configured via UI. The check runs against live SLO data continuously."*
3. **Open Policy Studio → `acme.pii-requires-governance-approval`.** Show the Rego. *"Every governance rule is code. Every change is audited. There are no spreadsheets and no email approvals."*
4. **Switch to `compliance@beta.example.com`.** Different tenant, completely isolated, different policies. *"Multi-tenancy is row-level. The PCI scope policy you just saw doesn't even *exist* in the other org's namespace."*
5. **Click the Marketing Copilot agent.** Show classification history + the policy that gates a promotion to Autonomous. *"AI agents are governed the same way. Same audit trail. Same approval requirement. The compliance team is the gatekeeper for autonomy."*
6. **Open the Audit Log query view.** Show recent agent activity with verified identity context. *"Every agent action is signed, scoped, and recoverable. Append-only. No DELETE permissions at the database level."*

**What to lean into:** F12 (connection references + per-use-case consent), audit-log immutability, the four compliance states, the agent trust model. This audience cares about *teeth*, not features. Show the enforcement points.

---

## 11. Rough edges to avoid in live demo

### Active (open bugs that will bite if you don't know about them)

- **[B-078](../bugs/resolved.md#B-078) + [B-085](../bugs/resolved.md#B-085) — hard reset is now safe (PR #234).** Previously `demo-reset.sh --hard` truncated `flyway_schema_history` (api wouldn't boot on next recreate) and wasn't repeatable on a seeded box (orphaned KC clients 500'd `/seed/agents`). Fixed in #234. Until that PR is deployed to the target box, prefer soft reset and see the Section 0 recovery note.
- **[B-082](../bugs/open.md#B-082) — MCP `get_product` 500 when `domain_id` omitted.** Only product-bound tool that requires `domain_id` (the other three take `product_id` alone). For the Audience B live MCP demo, use `get_trust_score`, `get_lineage`, or `get_slo_summary` — they're the verified working path. If you must show `get_product`, pass both `product_id` and `domain_id`.

### Standing caveats

- **Fictional warehouse endpoints.** The seeded connection details point at `warehouse.acme.example.com` (SQL `host`), `api.acme.example.com` (REST `baseUrl`), and similar. They're illustrative — the generated snippets are real and copy-pasteable, but the hosts won't resolve. Mention "these are illustrative — the *contract* is what's enforced, the *host* points at the domain's own infrastructure." (Snippets also leave credentials as `<set via env>` placeholders by design — the platform never injects plaintext secrets.)
- **Synthetic classification-change notification.** Section 5 and Section 6 cover this in detail: the Marketing Copilot `classification_changed` notification is a seeded *signal*, not a real history entry. The agent's current classification is `observed`. Don't drill into the agent expecting to see the change.
- **Demo URL ≠ persistent.** The demo box is stop/start lifecycle, not always-on. `demo.provenancelogic.com` resolves only when the instance is started; expect a 2-min warm-up.
- **Agent Autonomous tier.** Don't try to promote any agent to Autonomous live — there's no UI workflow for it yet and it requires a governance role with a non-null reason. If asked, say "this is gated to manual intervention by design."
- **Dev-mode UI affordances.** The frontend is currently served by Vite in dev mode. There may be subtle dev-mode banners or affordances visible. Production-mode demo image is a deferred follow-up.
- **Lineage time-travel and PNG export.** Not yet shipped (ADR-003 follow-ups). If someone asks "can you show this graph at last Friday's snapshot?" — answer "F5.17, on the roadmap, not in this build."

### Smoke test status

The `demo-smoke-test.sh` was rewritten in #214 (the B-076/B-077 fix) and now exercises all 6 layers including the MCP agent path. Verified green in 4s on 2026-05-30. **Safe to run pre-demo as a confidence check** (previous "don't run the smoke test" advice from B-050 is obsolete — B-050 was fixed). The smoke test only exercises `list_products` (exempt path) — it does NOT verify product-bound MCP tools, so green smoke ≠ guarantee against the B-082 class of regression. Followup tracked separately.

---

## 12. What this inventory is *not*

- Not a script. Take it to Claude.ai or another co-author for narrative shape, audience-specific tone, time pacing, hooks, transitions, and rehearsal Q&A.
- Not a list of features. It's a list of what's *demo-able* given what's actually seeded right now.
- Not stable. The seed evolves. Re-generate from `packages/seed/src/` if it's been more than a few weeks since this file was committed.

---

## Appendix: file mapping

| Seed source | What's in it |
|---|---|
| `packages/seed/src/orgs/` | Acme + Beta org definitions, domains |
| `packages/seed/src/users/` | All 11 seeded users with roles and domain bindings |
| `packages/seed/src/products/` | All 10 product definitions including port contracts and connection details |
| `packages/seed/src/agents/index.ts` | Marketing Copilot + Risk Assistant |
| `packages/seed/src/lineage/index.ts` | All 8 lineage edges |
| `packages/seed/src/slos/` | All 20 SLO declarations |
| `packages/seed/src/policies/` | All 6 OPA Rego policies |
| `packages/seed/src/access/` | All access requests + grants (human grants + agent grants) |
| `packages/seed/src/consent/` | Connection references (Domain 12) — paired with the agent grants (added PR #226) |
| `packages/seed/src/notifications/` | All seeded notifications (the "live signals" that make the demo feel inhabited) |
