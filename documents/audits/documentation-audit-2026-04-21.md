# Documentation Consistency Audit — 2026-04-21

**Auditor:** Claude Code (automated pass)
**Scope:** `documents/` tree plus root-level README/CLAUDE/CONTRIBUTING files.
**Authoritative state-of-the-world sources for this audit:**

- `CLAUDE.md`
- `documents/prd/Provenance_PRD_v1.4.md`
- `documents/architecture/Provenance_Architecture_v1.4.md`
- `documents/prd/implementation-status.md`

**Current state snapshot (2026-04-21):**

- Phases 1–4 complete (as of 2026-04-13)
- Phase 5 "Open Source Ready" active — 5.1–5.4 complete; Domain 10 Workstream A complete; Workstream B in progress; 5.5–5.7 remaining
- Phase 6 "Production Scale" planned, triggered when funded
- Current PRD: v1.4. Current Architecture: v1.4. ADRs in force: ADR-001 (superseded by ADR-002), ADR-002, ADR-003, ADR-004
- `https://dev.provenancelogic.com` is an internal dev deployment on EC2 that is shut down most of the time; not a persistent public endpoint

This report is informational only — findings are NOT fixed here. The requirements persona should review and prioritize which ones to address.

---

## Methodology

Every file under `documents/` was scanned for:

1. Live-endpoint claims implying persistent public availability of `dev.provenancelogic.com` (or `auth.*` / `demo.*` variants).
2. Phase status claims that disagree with the current snapshot above.
3. PRD or Architecture version references pointing at superseded versions.
4. Technology decisions that contradict a ratified ADR (e.g. lineage visualization, agent auth).
5. Cross-document contradictions on factual matters.
6. References to files or artifacts that do not exist in the repo (verified with directory listings).
7. Internal inconsistencies (conflicting dates, counts, acronym expansions, etc.).

Findings are graded:

- **High** — Public-facing or actively misleading to readers acting on the content.
- **Medium** — Internal inconsistency likely to confuse contributors.
- **Low** — Cosmetic or stale-metadata issue.

---

## Findings

### H1. `documents/known-limitations.md` references PRD and Architecture files that do not exist

- **File:** `documents/known-limitations.md`
- **Line:** 93
- **Currently says:** `*For the complete requirements and architecture, see documents/prd/Provenance_PRD_v1.2.md and documents/architecture/Provenance_Architecture_v1.2.md.*`
- **Problem:** Neither `Provenance_PRD_v1.2.md` nor `Provenance_Architecture_v1.2.md` exist in the repo. Present versions are PRD v1.4 (`documents/prd/Provenance_PRD_v1.4.md`) and Architecture v1.4 (`documents/architecture/Provenance_Architecture_v1.4.md`). A v1.3 PRD also exists but should be treated as historical.
- **Should say:** Point readers at `documents/prd/Provenance_PRD_v1.4.md` and `documents/architecture/Provenance_Architecture_v1.4.md`.
- **Severity:** **High** — dangling reference in a doc that external contributors will read.

---

### H2. `documents/known-limitations.md` "last updated" line is stale relative to the current state snapshot

- **File:** `documents/known-limitations.md`
- **Line:** 3
- **Currently says:** `**Last updated:** April 13, 2026 — Phase 4 complete`
- **Problem:** That date and phase-marker were accurate at Phase 4 sign-off, but Phase 5 sub-workstreams 5.1–5.4 have since completed (5.2 on 2026-04-18, 5.3 on 2026-04-16) and Domain 10 Workstream B is now mid-flight. Readers could plausibly conclude that limitations listed here are all still live when several may already be resolved.
- **Should say:** The document should either be re-dated with a Phase 5 snapshot or explicitly framed as the Phase 4 sign-off limitations set. A follow-up pass to reconcile each listed limitation against `documents/prd/implementation-status.md` is recommended.
- **Severity:** **High** — "known limitations" is exactly the doc a new contributor or evaluator consults first.

---

### M1. `ADR-001-mvp-agent-authentication.md` references a non-existent architecture version

- **File:** `documents/architecture/adr/ADR-001-mvp-agent-authentication.md`
- **Line:** 83
- **Currently says:** `*See documents/architecture/Provenance_Architecture_v1.2.md Section 3 (MVP Agent Authentication Pattern) for the architectural context.*`
- **Problem:** `Provenance_Architecture_v1.2.md` is not in the repo. ADR-001 has itself been superseded by ADR-002 (JWT auth), so ADR-001 is now a historical record — but the file pointer inside it is still broken.
- **Should say:** Point at `documents/architecture/Provenance_Architecture_v1.4.md`, or preserve the historical intent by noting the referenced section moved to v1.4.
- **Severity:** **Medium** — ADR-001 is historical context, but the broken file reference undermines the audit trail.

---

### M2. Lineage visualization technology is described inconsistently across documents

- **Canonical decision (ADR-003, 2026-04-18):** React Flow + Dagre, superseding the earlier D3 force-directed approach. PRD v1.4 reflects this.
- **Contradictions still present:**
  - `README.md` line 94 (pre-audit): `| Visualization | Cytoscape.js | Interactive lineage graph explorer |` — Cytoscape.js was never the ratified choice. (Fixed in the companion README commit, flagged here for completeness.)
  - `README.md` line 145 (pre-audit): `Interactive Lineage Explorer UI with Cytoscape.js graph visualization and dagre layout` — same issue. (Fixed in the companion README commit.)
  - `README.md` line 186 (pre-audit): `│ ├── lineage/ # Lineage Explorer (Cytoscape.js)` — same issue. (Fixed in the companion README commit.)
- **Within `documents/`:** An audit of the `documents/` tree did not surface a document still claiming Cytoscape.js. Any doc in `documents/` referring to "D3", "force-directed", or "Cytoscape" for the lineage UI should be cross-checked against ADR-003 before a next release.
- **Severity:** **Medium** — the README divergence was user-visible; the `documents/` tree appears clean on this axis today but this class of drift should be a standing grep target.

---

### M3. `https://dev.provenancelogic.com` is described as a "persistent" environment in ADR-004, conflicting with operational reality

- **File:** `documents/architecture/adr/ADR-004-demo-environment-strategy.md`
- **Problem:** ADR-004 draws a contrast between `dev.provenancelogic.com` (framed as the "persistent development environment" for the core team) and the demo environment (on-demand, provisioned per demo). The framing is correct in spirit — dev is a *logically* persistent environment compared to demo — but it is not a persistent public endpoint. The EC2 instance is shut down most of the time, so any reader treating "persistent" as "reachable 24/7" will be misled.
- **Should say:** Clarify that "persistent" in ADR-004 means *logically persistent* (state and config survive shutdowns), not *continuously reachable*. Spell out that the dev instance is shut down when not in active use to keep costs down and availability cannot be assumed.
- **Severity:** **Medium** — the ADR is a contributor-facing doc; this affects how contributors plan demos and testing.

---

### M4. `CLAUDE.md` closes the Phase 5 progress block with a bare URL that reads as a public hand-off

- **File:** `CLAUDE.md`
- **Line:** 229
- **Currently says:** `Live development environment: https://dev.provenancelogic.com`
- **Problem:** CLAUDE.md is internal, so the severity is lower than the README version — but the bare-URL framing is identical to the pattern being removed from README. If this line is ever lifted into a summary or surfaced to a reader outside the core team (e.g. via Claude surfacing it in a chat), it will repeat the live-URL misconception.
- **Should say:** Either drop the line or reframe to make clear availability is not guaranteed, e.g. "Internal dev deployment (not continuously reachable): https://dev.provenancelogic.com".
- **Severity:** **Medium** — internal file but referenced from tooling that could resurface the phrasing.

---

### M5. `CLAUDE.md` claims Architecture v1.4 is the companion version but references an ADR file that does not exist at that path

- **File:** `CLAUDE.md`
- **Line:** 387
- **Currently says:** `* Architecture Decision Records: documents/architecture/adr/ (ADR-001, ADR-002, ADR-003)`
- **Problem:** The ADR directory also contains `ADR-004-demo-environment-strategy.md`, and CLAUDE.md itself references ADR-004 earlier (line 247). Listing only ADR-001–003 under "Full Documentation" omits ADR-004 and risks an inconsistency where ADR-004 is cited elsewhere but appears to not exist from the index alone.
- **Should say:** `(ADR-001, ADR-002, ADR-003, ADR-004)`.
- **Severity:** **Medium** — index inconsistency; easy to fix.

---

### M6. Verification status header in `README.md` is labelled "(Phase 3)" while describing phase-agnostic smoke checks

- **File:** `README.md`
- **Line:** 115 (retained after the companion README commit)
- **Currently says:** `### Verification Status (Phase 3)`
- **Problem:** The test breakdown underneath (15 API tests, 8 browser checks) is broader than Phase 3 — it now implicitly spans Phases 1–4. The bracketed "(Phase 3)" label is a relic from when Phase 3 was the most recently sign-offed phase.
- **Should say:** Drop the parenthetical phase tag, or explicitly state it's a Phase 4 sign-off snapshot with a date. Flagged here rather than fixed in the companion commit because it is an editorial call for the requirements persona, not a factual error.
- **Severity:** **Medium** — README is public-facing; phase labelling on a verification summary is easily misread.

---

### L1. `documents/prd/Provenance_PRD_v1.3.md` is still in the tree

- **File:** `documents/prd/Provenance_PRD_v1.3.md`
- **Problem:** PRD v1.4 is the authoritative version. v1.3 remains in the tree without any explicit "SUPERSEDED" marker in the filename or leading frontmatter. No other document currently appears to point at v1.3 by filename (they reference v1.4), but keeping v1.3 in the tree invites future references.
- **Should say:** Either move to `documents/prd/archive/` or add a prominent "SUPERSEDED by v1.4" banner at the top of the file.
- **Severity:** **Low** — housekeeping, not active misinformation.

---

### L2. `documents/architecture/Provenance_Architecture_v1.4.md` changelog block references the v1.2 → v1.3 diff as if v1.2 is still on disk

- **File:** `documents/architecture/Provenance_Architecture_v1.4.md`
- **Line:** 18 (and following)
- **Currently says:** The changelog block includes `**Changelog — v1.2 → v1.3**` without a note that v1.2 has been retired from the repo.
- **Problem:** Readers looking to compare against v1.2 will find nothing on disk. This is strictly a cosmetic issue inside an accurate historical-changelog block, but it is the ancestor of H1 / M1 above: the mental model "v1.2 is a file I can open" persists and seeds broken pointers.
- **Should say:** Either preserve a read-only `Provenance_Architecture_v1.2.md` in an `archive/` subdirectory, or add a one-line "(v1.2 not retained in repo)" note so future writers stop generating broken pointers.
- **Severity:** **Low** — cosmetic; root-cause of several higher-severity findings.

---

### L3. `documents/architecture/README.md` and `documents/prd/README.md` should be spot-checked against current versions

- **Files:** `documents/architecture/README.md`, `documents/prd/README.md`
- **Problem:** Not flagged as failing in this pass, but these two index files are a recurring source of version drift whenever PRD/Architecture versions bump. Recommend adding "update these two index READMEs" to the checklist for any future PRD/Architecture version bump.
- **Severity:** **Low** — process recommendation, not a current defect.

---

## Items explicitly verified and found consistent

- **MCP tool count:** CLAUDE.md, PRD v1.4, Architecture v1.4, and `implementation-status.md` all consistently report **9 MCP tools** with matching names (`list_products`, `get_product`, `get_trust_score`, `get_lineage`, `get_slo_summary`, `search_products`, `semantic_search`, `register_agent`, `get_agent_status`).
- **Phase status:** Phases 1–4 marked complete, Phase 5 active with the same workstream breakdown, Phase 6 "when funded" — consistent across CLAUDE.md, README.md, PRD v1.4 and `implementation-status.md`.
- **Agent authentication:** ADR-002 (JWT via Keycloak `client_credentials`) is consistently cited as the current mechanism. ADR-001 is consistently referenced as superseded. No stray document was found claiming the Phase 4 `X-Agent-Id` header is the current pattern.
- **Architecture/PRD version badges in README.md:** v1.4 on both after the companion commit (pre-commit the architecture badge was v1.0; fixed).
- **Demo environment references:** `documents/runbooks/demo-environment.md` and ADR-004 agree on the shape (per-demo provisioning, terraform state local, smoke-test-before-demo rule). No contradictions surfaced in this pass.

---

## Summary

| Severity | Count |
|---|---|
| High | 2 |
| Medium | 6 |
| Low | 3 |

The single structural root cause behind the High-severity findings is the retirement of PRD/Architecture v1.2 from disk without leaving either a stub or an archive copy. Every dangling reference in this report traces back to that one decision. The simplest durable fix is either:

1. Keep one retired version on disk under `documents/{prd,architecture}/archive/` so historical pointers do not break, or
2. Do a single sweeping pass updating every reference to the current `v1.4` file.

Option 2 is cleaner if the team has the appetite; option 1 is lower-effort if not.

---

*End of report.*
