# Demo Asset Inventory

A factual, grounded reference for what *exists* on the seeded demo environment right now. Use this as the input to a demo script — it tells you which orgs, products, agents, lineage edges, policies, and *live signals* are sitting on the demo box, ready to be clicked through.

This file does **not** prescribe a narrative or tone. That's the layer you'd take into Claude.ai or a co-founder review. This file is the underlying ground truth.

**Source of truth for everything below:** `packages/seed/src/`. If the seed changes, this file is stale — regenerate from current main.

**Demo URL:** https://demo.provenancelogic.com (live as of 2026-05-17). Everyone below logs in with password `DemoPass123!`.

> **⚠️ Known issues from the 2026-05-17 investor-demo rehearsal.** The walkthrough turned up five bugs (B-054 through B-058) that affect the click paths in Section 10. Read **Section 11 ("Rough edges to avoid in live demo")** before walking any of the scripts — it has the specific workarounds. Most consequential: B-054 (clicking the access-request notification *silently grants* the access without the approval UI ever loading — do not click that notification on stage until B-054 lands).

---

## 0. Demo setup (before the live walk)

A few things that are not bugs but bite the first time:

**Multi-persona switching needs separate browser contexts.** Keycloak uses a domain-scoped session cookie. Logging in as a new persona in *any* tab logs *all* tabs into that persona. The "have three tabs open with three personas" mental model doesn't work in a single browser window. Three options, recommended first:

1. **Chrome profiles (recommended).** Create one named Chrome profile per persona you'll demo (e.g. "Maya — Marketing", "Aiden — Analyst", "Gita — Governance"). Each profile keeps its own cookies. Log in once per profile, bookmark the starting URL. Persona-switching during the demo becomes a taskbar click.
2. **Separate browsers.** Chrome + Firefox + Safari, one persona each. Works in a pinch.
3. **Separate incognito / private windows.** Chrome incognito windows have isolated sessions per *window* (not per tab). Safari private windows share state across private windows — only one Safari private window at a time. Use Chrome incognito or Firefox private windows for this.

**Have the demo box started before the demo.** Cold-start from `aws ec2 start-instances` takes ~2 min. Land the prep before audience joins.

**Verify the state is pristine** before each new demo (the script in Section 10 relies on specific unread/pending signals being intact). Once the demo-reset workflow is verified (status board "Up next" item), run `bash infrastructure/scripts/demo-reset.sh --hard` between rehearsals.

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

| Agent | Org | Trust classification | Oversight contact | Notable |
|---|---|---|---|---|
| Marketing Copilot | Acme Corp | `observed` | marketing-lead@acme.example.com | Recent classification change from `observed` → `supervised` (visible in governance@acme's notifications) |
| Risk Assistant | Beta Industries | `observed` | compliance@beta.example.com | Held at Observed by `beta.risk-domain-observed-only` policy — promoting it requires governance grant |

**Demo angle.** Open the agent registry. Both agents have JWT-based authentication (ADR-002). The Marketing Copilot has a classification-change audit trail you can show. The Risk Assistant's "stuck at Observed by policy" is the right hook for the federated governance story.

---

## 6. Live signals seeded into the demo (the most underrated demo asset)

This is what makes the demo feel *alive* — open the right login and there's already an interesting signal demanding attention.

### As `governance@acme.example.com`
- **Compliance drift detected** on Customer 360 — PII completeness at 93.2% vs 95% policy floor. Deep links to `/governance/compliance`.
- **Classification changed** for Marketing Copilot (observed → supervised). Already read but in history. Deep links to `/agents/marketing-copilot`.

### As `finance-lead@acme.example.com`
- **Trust score significant change** on Daily Revenue Recognition — dropped from 0.91 to 0.78. Reason: reconciliation match rate fell below 99.5% SLO floor twice this week. Deep links to `/marketplace/revenue-daily/trust`. **This is the strongest single moment in the demo for "the platform tells you something is wrong before you ask."**
- **Pending access request** from Samuel Okafor (supply-lead) wanting to reconcile inventory write-offs against revenue postings.

### As `marketing-lead@acme.example.com`
- **SLO violation** on Campaign Attribution — p95 latency 742ms vs 500ms threshold. Deep links to `/publishing/campaign-attribution/observability`.
- **Pending access request** from Aiden Chen (analyst) wanting Customer 360 for a Q3 cohort retention dashboard.

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

## 8. Access requests + grants (the workflow surface)

- **7 access grants** seeded across both orgs (3 active and healthy, 1 expiring on Acme, 3 on Beta with one expiring in 5 days)
- **5 access requests** in various states — 3 pending (each one a "click this to approve" moment), 1 approved with history, 1 denied with rationale

Best demo flow: log in as `marketing-lead@acme.example.com` → Notifications → click the pending request from Aiden Chen → walk through the approval UI → grant emits a *connection package* with curl / JDBC / Python snippets.

---

## 9. The MCP / agent surface

Phase 4 is live. From any agent-registered Keycloak client (the two seeded ones above), the MCP SSE endpoint at `https://demo.provenancelogic.com/mcp/sse` (or port 3002 direct on the dev box) exposes 9 tools: `list_products`, `get_product`, `get_trust_score`, `get_lineage`, `get_slo_summary`, `search_products`, `semantic_search`, `register_agent`, `get_agent_status`.

**Demo angle.** If your audience is technical, do a live MCP tool call from Claude Code or a sample MCP CLI. The "human-discoverable AND agent-discoverable, governed identically" claim becomes tangible.

**Caveat:** the connection-details `endpoint` strings on the products refer to *fictional* hosts (`warehouse.acme.example.com`, `api.beta.example.com`, etc.). Those are illustrative — don't actually click the example client commands expecting them to reach a backing store. The MCP tools themselves *are* real and return real data from the seeded product catalog.

---

## 10. Per-audience skeleton click paths

These are *skeletons* — bullet points that mark out the shape of a walk. Take them into Claude.ai for narrative dressing.

### Audience A: Investor / non-technical (10 min)

> **🚨 Rehearsal blockers (2026-05-17):** Steps 4, 6, 7, and 8 below all hit bugs filed in the rehearsal walkthrough. Specifically: Step 4 trips B-054 (notification click silently grants — but no approval UI loads); Steps 6 and 7 trip B-057 (no agent detail page); Step 8 trips B-058 (trust-score-drop notification missing from governance inbox). **Do not run this script unmodified until B-054, B-055, B-057 land.** Workarounds below; full bug details in `bugs/open.md`.

The story is "**this is a coordination platform for the AI-agent era.**" Show, don't explain.

1. **Open marketplace** as `analyst@acme.example.com` (a non-owner consumer). One screen: 10 products across two orgs, with trust scores, owners, lifecycle states, freshness SLAs. *"This is what data looks like when it's a *product*, not a table."*
2. **Click Customer 360** → show schema + ownership + lineage tab + trust score breakdown. *"Every product has a contract, an owner, a service level."*
3. **Click "Request Access."** Show the request form. Submit. *"Self-serve, not a Jira ticket."*
4. **Switch login to `marketing-lead@acme.example.com`** (the owner). Notification bell shows the pending request. **⚠️ B-054 / B-055 workaround:** *do not click the notification* — it currently has no inline approve action and clicking it silently grants the request without loading any UI. Instead, navigate directly to the product's access-requests page (`/publishing/customer-360/access-requests`) and approve from there. *"The compliant path is the easy path."*
5. **Switch back to analyst.** Now the connection package is visible — JDBC URL, curl snippet, Python snippet, MCP integration guide. *"Approved means *usable*, not 'wait three days for IT.'"*
6. **Open the Agent Registry** (one click). Show the two registered agents with trust classifications. *"And it works the same way for AI agents. Same governance, same audit, same trust contract."* **⚠️ B-057 workaround:** the rows aren't clickable and there's no detail page yet. Make the trust-classification + oversight-contact point verbally from the row content. Skip the "click into agent detail" beat.
7. **(B-057-blocked — collapse into Step 6.)** Originally: open Marketing Copilot's audit trail and show the classification-change history. Until the agent detail page exists, narrate the audit-trail point without navigating: *"every agent action is provenanced — same word the company is named for."*
8. **Open `governance@acme.example.com`.** Show the compliance drift signal on Customer 360. **⚠️ B-058 — script-vs-data mismatch:** the *original phrasing of this step* implied the trust-score-drop notification was in `governance@acme`'s inbox. It isn't — it's seeded for `finance-lead@acme.example.com` (which Section 6 of this file always correctly listed; the script step was the inconsistent one). **For the strongest demo moment, switch to `finance-lead@acme.example.com` for the trust-score beat** — the 0.91 → 0.78 notification is there. *"And the platform tells you when something is wrong before you ask."* Honest answer to the bug: governance roles arguably *should* see this notification too — that's the fix path documented in B-058.

**What to avoid:** don't run the smoke test. Don't show the dev-mode URL bar (port 3000 etc.). Don't say "this is built on Kubernetes" — it's not, yet. The architecture story is *the right one for production*; the current MVP is Docker Compose on EC2 and that's fine.

### Audience B: Technical colleague / data architect (15 min)

> **🚨 Rehearsal blocker (2026-05-17):** Step 7 below (agent detail page) trips B-057 — the page doesn't exist. Collapse Steps 7 and 8 into a single beat where you point at the agent registry row and narrate the rest. Also note B-056 (logout from `/agents` returns raw JSON 404) — *don't log out from the agents tab*; navigate to `/` first.

The story is "**we made all the right architecture calls and there's evidence of each one in the running stack.**"

1. **Open the Lineage Explorer** on `revenue-daily`. Show the DAG. *"Native graph database for the lineage layer (Neo4j) — arbitrary-depth traversal is the wrong shape for relational, here's why."*
2. **Click any upstream node.** Show navigation. *"Time travel is on the roadmap (F5.17), not yet shipped — but the data model already supports it."*
3. **Open the Policy Studio.** Show one of the seeded OPA policies — `beta.pci-scope-isolation` is a good one. *"Governance is computational, not procedural. This is real Rego, hot-reloadable, enforced at request time."*
4. **Show the Compliance Monitor.** Drift detection on Customer 360 with the 93.2% vs 95% number. *"Drift detection runs continuously; products move through Compliant / Drift Detected / Grace Period / Non-Compliant automatically."*
5. **Open the API docs at `/api/v1/docs`.** OpenAPI 3.1 rendered live, source-of-truth specs in `packages/openapi/`. *"Every API surface in the platform is spec-first."*
6. **Live MCP demo.** From your terminal, hit the MCP server and call `list_products` then `get_trust_score`. *"Agents are first-class. Same JWTs, same row-level-security, same audit log."*
7. **Open the Agent Detail page** for Marketing Copilot. Show the trust classification, the oversight contact, the audit trail. *"Three trust tiers — Observed, Supervised, Autonomous. Autonomous can never be set programmatically; only a governance role can promote."*
8. **The persistence story for connection references.** Mention Domain 12 (ADR-005 through ADR-008) — "every agent action requires both an active access grant AND an active connection reference with use-case scope." Don't deep-dive unless they ask.

**What to lean into:** the five non-negotiables in `CLAUDE.md` (native graph, hot-reloadable policy engine, control-plane/data-plane separation, distinct agent query layer, native MCP). Each one is visible somewhere in the running stack. Show, point, move on.

### Audience C: Governance / compliance officer (12 min)

> **🚨 Rehearsal blocker (2026-05-17):** Step 5 (click the Marketing Copilot agent) trips B-057 — there is no agent detail page. The classification-history beat has to be narrated rather than shown. The connection-reference surface for Domain 12 also has no UI today — make it a verbal point. Also, since this is the audience that cares most about audit-trail / approval-evidence integrity, **mention B-054 openly if it comes up** — "we found a notification-click side-effect bug in rehearsal; fix is in flight" is a better answer than dancing around it.

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

### Known bugs from the 2026-05-17 rehearsal (must read before walking)

- **🚨 B-054 (High) — clicking the access-request notification silently grants the access.** Maya (or any owner) opens the notification center, sees Aiden's pending request, clicks it expecting to be routed to an approval UI. No UI loads. The request is granted anyway. The audit log records an `access_granted` with no human approval gesture. **Workaround for live demo:** do not click the access-request notification. Navigate directly to `/publishing/<product-slug>/access-requests` and approve from there. Talk through it as "I'm opening the product's access-requests view" rather than "I'm clicking the notification."
- **B-055 (Medium) — no inline approve/deny on the notification.** Sibling to B-054. The notification has no Approve/Deny buttons inline; the seeded `deepLink` field exists but isn't rendered as a primary CTA. **Workaround:** same as B-054 — navigate to the access-requests page directly.
- **B-056 (Medium) — logout from `/agents` returns a raw JSON 404.** NestJS error response leaks through to the browser. **Workaround:** before logging out, navigate to `/` (home). Then log out cleanly. **Never end a live demo by logging out from `/agents`** — the JSON error would be the audience's last impression.
- **B-057 (Medium) — no agent detail page.** Agent registry rows are not clickable; the detail surface (access grants, connection references, audit trail, classification history) doesn't exist yet. **Workaround:** make the points verbally from the agent-registry row. Skip every "click into agent" / "open the audit-trail tab" beat in the scripts. This affects Section 10A Steps 6–7, Section 10B Step 7, Section 10C Step 5.
- **B-058 (Low) — trust-score-drop notification not in `governance@acme` inbox.** The original Step 8 of the investor script (Section 10A) implied it would be; the seed only places it in `finance-lead@acme`. Section 6 of this file *correctly* lists it under finance-lead — the inconsistency was in the script step, not in Section 6. **Workaround for live demo:** switch to `finance-lead@acme.example.com` for the trust-score beat. **Fix path:** governance should arguably see this signal too — add `governance@acme` as a second recipient in `packages/seed/src/notifications/acme-corp-notifications.ts` using a distinct `seedKey` for idempotency.

### Pre-existing rough edges (still apply)

- **B-050.** `demo-smoke-test.sh` layer 2 step 3 hits a non-existent `/organizations/me` route and returns 500. Don't run the smoke test in front of an audience. Walk the UI directly.
- **Fictional warehouse endpoints.** The `connectionDetails.endpoint` strings on products point at `warehouse.acme.example.com` and similar. They're illustrative. If you click an example client command, it won't connect. Mention "these are illustrative — the *contract* is what's enforced, the *endpoint* points at the domain's own infrastructure."
- **Demo URL ≠ persistent.** The demo box is stop/start lifecycle, not always-on. `demo.provenancelogic.com` resolves only when the instance is started; expect a 2-min warm-up.
- **Agent Autonomous tier.** Don't try to promote any agent to Autonomous live — there's no UI workflow for it yet and it requires a governance role with a non-null reason. If asked, say "this is gated to manual intervention by design."
- **Dev-mode UI affordances.** The frontend is currently served by Vite in dev mode. There may be subtle dev-mode banners or affordances visible. Production-mode demo image is a deferred follow-up (status board "Deferred to post-launch").
- **Lineage time-travel and PNG export.** Not yet shipped (ADR-003 follow-ups). If someone asks "can you show this graph at last Friday's snapshot?" — answer "F5.17, on the roadmap, not in this build."

### When to update this section

Each of the B-054/55/56/57/58 entries above should move to a "Recently resolved" callout (and then disappear entirely) as the fixes land. The B-054 silence-on-fix would be especially worth noting: it's the strongest "show the platform is honest about its bugs" beat if asked by a governance-flavored audience.

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
| `packages/seed/src/access/` | All access requests and grants |
| `packages/seed/src/notifications/` | All seeded notifications (the "live signals" that make the demo feel inhabited) |
