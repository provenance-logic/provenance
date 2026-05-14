# Documentation Index

Start here to find your way around Provenance's documentation.

The repo root [`README.md`](../README.md) is the orientation; this directory holds the authoritative requirements, architecture, planning, and operational documents. Where two documents disagree, the precedence rule is `osr-roadmap.md` (priority / deferral truth) > `implementation-status.md` (per-feature truth) > everything else.

## What to read first

If you're evaluating Provenance:

1. [`../README.md`](../README.md) — Project overview, technology stack, getting started.
2. [`prd/Provenance_PRD_v1.5.md`](./prd/Provenance_PRD_v1.5.md) — All twelve platform domains, features, and requirements.
3. [`prd/implementation-status.md`](./prd/implementation-status.md) — Per-feature build status vs. the PRD. Authoritative for what's actually shipped.

If you're a contributor or operator:

1. [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — Contribution guidelines and development setup.
2. [`architecture/Provenance_Architecture_v1.5.md`](./architecture/Provenance_Architecture_v1.5.md) — MVP and production architecture, technology decisions, build sequence.
3. [`runbooks/`](./runbooks/) — Demo environment and operations runbooks.

If you're planning OSR launch work:

1. [`prd/osr-roadmap.md`](./prd/osr-roadmap.md) — Stage 0–5 breakdown, what's shipped, what's deferred.
2. [`bugs/open.md`](./bugs/open.md) and [`bugs/resolved.md`](./bugs/resolved.md) — Bug tracking.

## Directory map

| Path | What's in it |
| --- | --- |
| [`prd/`](./prd/) | Product Requirements Document v1.5, implementation status, OSR roadmap |
| [`architecture/`](./architecture/) | Architecture document v1.5, ADRs, plans |
| [`runbooks/`](./runbooks/) | Operations and demo-environment procedures |
| [`bugs/`](./bugs/) | Open and resolved bug tracking |
| [`audits/`](./audits/) | Documentation audits |
| [`known-limitations.md`](./known-limitations.md) | Explicit scope boundaries |
