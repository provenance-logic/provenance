# Product Requirements & Status

This directory holds the authoritative product requirements for Provenance and the documents that track build progress against them.

## Documents

| Document | Purpose |
| --- | --- |
| [`Provenance_PRD_v1.5.md`](./Provenance_PRD_v1.5.md) | **Product Requirements Document v1.5.** All twelve platform domains, every functional (F-ID) and non-functional (NF-ID) requirement, and explicit out-of-scope items. The contract the product is built against. |
| [`implementation-status.md`](./implementation-status.md) | **Per-feature truth.** Status of every requirement in the PRD — Implemented / Partial / Not implemented — with notes on what's shipped, what's deferred, and where to find the code. Authoritative for "is X built." |
| [`osr-roadmap.md`](./osr-roadmap.md) | **Priority and deferral truth.** Stage 0–5 breakdown of the Open Source Readiness push toward `v0.1.0-osr`. Records what shipped, what's "deferred with no shame" to post-launch, and the sequence of remaining work. Authoritative for "what to do next." |

## When the two status documents disagree

Where `implementation-status.md` and `osr-roadmap.md` describe the same feature with different framing, the roadmap wins for *what to prioritize* and the status doc wins for *what's built*. The reconciliation PR ([#89](https://github.com/provenance-logic/provenance/pull/89), 2026-05-14) added explicit cross-references between the two so this trap doesn't catch future readers.

## Related

- Bug tracking: [`../bugs/open.md`](../bugs/open.md) and [`../bugs/resolved.md`](../bugs/resolved.md).
- Architecture decisions that operationalize PRD requirements: [`../architecture/adr/`](../architecture/adr/).
