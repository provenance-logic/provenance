# ADR-004: Demo Environment Strategy

**Date:** April 19, 2026
**Status:** Accepted
**Author:** Provenance Platform Team

---

## Context

Provenance currently has one persistent environment: a two-EC2 production instance running at dev.provenancelogic.com. There is no staging tier.

The platform needs to support a monthly demo cadence for design partners and investors. The options considered were:

- **Persistent staging tier**: a second always-on environment mirroring production
- **Demo against dev/production**: use the existing dev environment for demos
- **Local demo**: run the platform on a laptop during the demo
- **On-demand demo clone**: provision a fresh environment per demo, tear it down between uses

The constraints shaping this decision:

- **Budget**: pre-revenue, open source project. A persistent staging tier adds $200-350/month for infrastructure that is idle most of the time.
- **Solo builder**: no dedicated DevOps capacity to maintain a second persistent environment. Drift between environments is a real operational risk when there is one person managing both.
- **Demo cadence**: approximately monthly. At that frequency, a persistent environment is idle more than 95% of the time.
- **Demo requirements**: clean state, realistic data, no risk of a live demo exposing incomplete features or corrupted data from development work.
- **Development velocity**: a persistent staging environment would create pressure to keep it in sync with dev, adding maintenance overhead to every deployment.

---

## Decision

Use an on-demand demo clone provisioned per demo, sourced from git, with curated seed data, and torn down between uses.

**How it works:**

1. At T-24h before a demo, Terraform provisions a fresh EC2 instance at demo.provenancelogic.com from the same AMI and configuration as the dev environment
2. `infrastructure/scripts/demo-bootstrap.sh` installs Docker, clones the repo at the specified git SHA, configures Caddy for TLS, and creates the `.env` from the demo template
3. `infrastructure/scripts/demo-sync.sh` pulls the target image, runs database migrations, imports the Keycloak realm, runs the seed package (`npm run seed`), and runs the smoke test
4. `infrastructure/scripts/demo-smoke-test.sh` verifies the environment is demo-ready (six layers of checks, target runtime under 60 seconds, exits non-zero on failure with a specific failure message)
5. The demo runs against demo.provenancelogic.com
6. After the demo, `infrastructure/scripts/demo-reset.sh` runs a soft reset between back-to-back demos, or Terraform destroys the instance after the final demo

**Key properties of this approach:**

- The demo environment is always at a known git SHA, sourced from the same repo as dev
- Curated seed data in `packages/seed/` tells a coherent demo narrative regardless of what state dev is in
- Dev can be in any state during a demo with zero risk of contamination
- The demo environment costs money only when running (a few hours per demo)
- There is no drift to manage between demos because the environment is rebuilt from scratch each time

---

## Why Not the Alternatives

**Persistent staging tier**: $200-350/month for an environment that is idle 95% of the time. More importantly, maintaining two persistent environments as a solo builder creates a drift problem. Every deployment to dev needs to be replicated to staging. Every schema migration needs to be run in both places. The operational overhead compounds over time and ultimately slows development velocity.

**Demo against dev**: Dev is a working development environment. It will have incomplete features, experimental data, partially applied migrations, and whatever state the last development session left it in. Demoing against dev is a reliability risk that increases as development pace increases.

**Local demo**: Creates hardware dependency (the demo only works on one specific laptop), connectivity risk (demo venues have unreliable WiFi), and requires keeping a local environment in sync with the current codebase. Not viable for a cloud-native platform where the demo should demonstrate the actual deployed product.

---

## Consequences

**What this buys:**

- Clean, reproducible demo state every time regardless of dev environment state
- Zero idle infrastructure cost between demos
- No environment drift to manage
- Dev environment is never at risk during a demo
- The seed package (`packages/seed/`) becomes a forcing function for maintaining realistic demo data, which also serves as the foundation for Phase 5.6 developer experience seed data

**What this does not buy:**

- Continuous integration testing against a staging environment
- Stakeholder self-serve access to a persistent demo environment between demos
- Pre-demo confidence that a feature works in a production-like environment beyond what the smoke test verifies

**Operational reality:**

The smoke test (`demo-smoke-test.sh`) is the reliability guarantee. Six layers of checks covering infrastructure, authentication, control plane, agent layer, data plane, and observability. If the smoke test passes, the demo will work. The smoke test must be run and must pass before every demo. This is a procedural requirement, not a technical enforcement.

---

## When to Revisit

This decision is appropriate for the current stage. Revisit if any of the following occur:

- **A design partner wants to integrate**: integration requires a stable, accessible endpoint beyond demo hours. A persistent environment becomes necessary at that point.
- **Demo frequency exceeds roughly 2 per month**: at that cadence the operational overhead of spinning up and tearing down per demo starts to exceed the cost of a persistent environment.
- **A funding event**: investor due diligence often requires access to a running environment over a period of days, not hours.
- **Dev freeze cost exceeds roughly one week per month**: if keeping dev stable for demos is consuming significant development time, a persistent staging tier is cheaper than the lost velocity.

---

## Related Documents

- Runbook: `documents/runbooks/demo-environment.md`
- Terraform: `infrastructure/terraform/demo/`
- Seed package: `packages/seed/`
- Demo scripts: `infrastructure/scripts/demo-*.sh`
