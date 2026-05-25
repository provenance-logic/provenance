# ADR-012: Connector Authentication Methods and the Spec-Driven Guided Registration Flow

**Date:** May 25, 2026
**Status:** Accepted (2026-05-25) — direction adopted; **no implementation yet.** This ADR records the decision and the phased build; the work is not started. Triggered by a persona walkthrough of Snowflake connector registration (see Context).
**Author:** Provenance Platform Team

---

## Resolves

Registering a connector today is an engineer-only task wearing a domain-owner's label. Concretely, for the Snowflake connector a user must, by hand: find their account locator and region, generate a PKCS#8 RSA key pair with `openssl`, register the public key on a Snowflake user via `ALTER USER … SET RSA_PUBLIC_KEY`, create a service user and role with the right GRANTs, assemble two JSON blobs (one of them containing a PEM with escaped newlines), arrange for the credential to be reachable behind a Secrets Manager ARN (or the `local-env:` sentinel), paste both blobs into a bare `{}` JSON textarea and a free-text ARN box, then separately trigger validate and crawl. There is no field-level guidance, no connection test with diagnostics, and the only auth method implemented is the most painful one Snowflake offers.

This ADR resolves three questions:

1. **Which authentication methods does the platform support for connectors, and which is the default?** (Today: key-pair JWT only.)
2. **How is the registration form built** — hand-coded per connector type, or driven by a declarative per-connector spec?
3. **Who registers a connector** — every domain owner self-serves, or an org admin registers once per source?

---

## Context

The platform's four-persona promise (AI agents, domain teams, data consumers, governance) puts "domain teams — human owners and publishers" as persona #2. The connector-registration UI (`apps/web/src/features/connectors/ConnectorsPage.tsx`) presents that persona with a generic form: Name, Domain, Connector type, a free-text **Credential ARN**, Description, and a raw **Connection config (JSON)** textarea defaulting to `{}`. A code comment in that file already concedes that per-type field schemas are "a follow-on once the operator UX for credentials is settled." That follow-on is this ADR.

The backend (`apps/api/src/connectors/probe/connector-probe.service.ts`) implements Snowflake auth as **key-pair JWT** only: it resolves `{privateKeyPem, user, account}` from the credential reference, signs an RS256 JWT, and calls Snowflake's SQL REST API. Key-pair is a legitimate and secure method — it is the right method for **unattended** service accounts — but it is the *hardest* of the three methods Snowflake supports, and we made it the *only* method and wrapped it in the *worst* UI.

**The benchmark that exposed this.** A walkthrough asked: would a real human do all of that just to register a connector? The honest answer was no — not the domain-owner persona, and not in this form. The comparison points are instructive:

- **Power BI → Snowflake** is effortless because it uses **OAuth**: the user clicks "Snowflake," a browser opens, they log in as themselves via SSO, they approve, done. No key generation. No service user. No GRANT SQL.
- **Databricks → Foundry** (and Databricks generally) is easy because it uses a **PAT** (personal access token): paste one `dapi…` string. Notably, *our own Databricks connector already uses this exact shape* (`{"token":"dapi…"}`) — so the easy pattern is already in the codebase, just not offered for Snowflake.

In both cases the ease comes from the **auth method choice**, not from the vendor having hidden some Snowflake requirement. Snowflake supports password, key-pair JWT, OAuth, and (recently) Programmatic Access Tokens. We chose the hardest one.

This decision is the **inbound mirror of [ADR-011](./ADR-011-configuration-brokerage.md)**. ADR-011 settled the *outbound* (consumer) question: the platform brokers configuration, and the consumer supplies their own source-system identity — "the Power BI bar." OAuth-based connector auth is the same principle applied *inbound*: at the moment of connection the domain owner authenticates **as themselves**, and the platform never sees a long-lived secret. The one asymmetry, addressed under Consequences, is that unattended re-crawl needs the platform to retain *something* (a refresh token or a service credential), which the consumer-query path does not.

**Prior art — elegant open-source connector UX we can learn from directly:**

| Source | Pattern worth taking |
| --- | --- |
| **Airbyte** | The canonical model: each connector ships a declarative `spec` (JSON Schema). The UI **auto-renders a typed form** from it — labels, help text, dropdowns, `airbyte_secret: true` to mask/route secrets, and `oneOf` to let the user pick an **auth method** (OAuth vs token vs key). A `check` operation validates the connection before anything is saved. OAuth is a first-class button flow. Adding a connector = shipping a spec, not hand-coding a React form. |
| **Singer / Meltano** | Config/state separation and a `--discover` step that produces a catalog. Reinforces "connect, then discover" as distinct phases — which maps onto our probe → crawl split. |
| **dbt** | The Snowflake profile selects auth per-target: `authenticator: externalbrowser` (OAuth SSO browser flow) or `private_key_path` (key-pair). Concrete proof that offering an **auth-method choice** is mainstream, not exotic. |
| **Grafana / Metabase / Superset** | "Add a data source / database": a per-driver typed form plus an explicit **Test connection** button that returns specific success/error ("connected, see N schemas" vs "auth failed"). The test-with-diagnostics step is most of the felt improvement. |

The throughline across all of them: **the connector declares its own config schema (including auth-method options and which fields are secret); the UI renders it; a check step validates it; discovery follows connection.** None of them hand-code a form per source, and none of them make the user paste raw JSON.

---

## Decision

### 1. Adopt a declarative per-connector configuration spec that drives a typed guided form

Each connector type declares a **config spec** (JSON Schema, Airbyte-style) describing its connection fields and auth methods: field name, label, help text ("where do I find this?"), type, whether it is a dropdown (and how the options are populated), and `secret: true` for sensitive fields. The frontend renders the form from the spec; the backend validates against it. Adding or changing a connector's form is a spec change, not a hand-coded React edit. This retires the raw `{}` JSON textarea.

The spec extends the existing capability-manifest machinery (`connectors.capability_manifests`, V31) rather than introducing a parallel concept — capability manifests already describe per-connector behavior and are immutable-per-version, which is the right home for the config schema too.

### 2. Offer three authentication methods, ordered by ease, defaulting to the easiest available

Auth method is a `oneOf` selector in the spec. For Snowflake:

- **A. OAuth — "Sign in with Snowflake" (default when configured).** The Power BI experience. The domain owner clicks one button, is redirected to Snowflake's login, approves, and returns connected **as themselves**. Zero key generation, zero service user, zero GRANT SQL. Discovery sees exactly what the user's own role can see. Requires a one-time org-admin Snowflake **security integration** (a single `CREATE SECURITY INTEGRATION`) and platform handling of **refresh tokens** for scheduled re-crawl. This is the on-thesis north star (see ADR-011).
- **B. PAT — "Paste an access token."** The Databricks experience, and the fastest to build because the pattern already exists in our Databricks connector. The user generates a Programmatic Access Token in Snowsight (clicks, no terminal) and pastes one string. **Prerequisite, verified the hard way on 2026-05-25:** Snowflake rejects *every* PAT with `401 "Network policy is required"` (error 390432) until the account/user is subject to a network policy, OR an authentication policy sets `PAT_POLICY NETWORK_POLICY_EVALUATION` to `ENFORCED_NOT_REQUIRED`/`NOT_ENFORCED`. PAT auth is not "just paste a token" — this prerequisite must be surfaced in the credential guidance (it is, in `connector-specs.ts`) and would belong in any future setup wizard. Live verification: `SELECT 1` over the SQL REST API with our exact PAT header returned `200`/`sqlState 00000` once the auth policy was in place.
- **C. Key-pair (advanced / unattended).** Retained for fully unattended service accounts. But the platform **generates the key pair for the user** (server-side) and hands them a single copy-paste line (`ALTER USER … SET RSA_PUBLIC_KEY='…'`) or a full setup script with a Copy button. The user never touches `openssl`. This drops key-pair from ~8 manual steps to ~2.

The use case picks the method; the platform stops forcing everyone down the hardest path. Postgres, S3, and Databricks declare their own appropriate subset (Databricks already = PAT).

### 3. A `check` (test-connection) operation with specific diagnostics

Before a connector is considered usable, a test step runs and returns actionable results: "✅ Connected — I can see 3 databases" / "⚠️ Authenticated, but role `X` can't see any tables — you may need a GRANT" / "❌ Auth failed — token appears expired." This replaces the current opaque guess-and-retry loop. Reuses and extends the existing `POST /connectors/:id/validate` probe.

### 4. Post-connection discovery populates the remaining fields

Parameters that are guesses today become dropdowns populated **after** auth: paste the Snowflake URL and the platform parses account/region/host; `SHOW WAREHOUSES` / `SHOW DATABASES` populate warehouse/role/database pickers. Nobody types `COMPUTE_WH` into a blob.

### 5. Connector registration is an org-admin act, performed once per source — not per-domain self-serve

The persona mismatch is half the problem. Registering a source connection (and the one-time OAuth security integration) is the responsibility of whoever administers the source system — an org admin / platform engineer — done **once per source**. Domain owners then **consume discovered sources** (bind ports to them, publish products) without ever touching auth. This is honest about who does this work in every comparable tool, and it does not weaken the mesh thesis: ownership of *data products* stays federated to domains; only the low-level *source connection* is centralized, which is where the credential and the expertise actually live.

---

## Consequences

### Positive

- **Maya-grade registration.** With PAT + a guided form (phase 1), the Snowflake flow goes from "engineer-only, terminal required, ~30 min" to "paste one token, pick from dropdowns, ~3 min, no terminal." With OAuth (phase 3) it becomes "click, sign in, done."
- **Extensible by construction.** New connectors ship a spec; the form, secret-handling, and validation come for free. This is the leverage that lets a small team keep adding connectors (BigQuery, MySQL) without per-type UI work.
- **On-thesis.** OAuth inbound is ADR-011's "keep your own identity" applied to discovery. The platform's credential surface area shrinks toward zero for the interactive case.
- **Diagnosable failures.** The check step removes the single biggest source of setup pain — the blind retry loop.

### Negative / costs (stated honestly)

- **OAuth is real, multi-day work, not a form tweak.** It needs the one-time security-integration setup flow, the authorization-code redirect handling, and a **refresh-token lifecycle** so scheduled re-crawls don't silently expire. This is why it is phase 3, not phase 1.
- **The spec engine is upfront investment.** Building the spec-driven form renderer costs more than hand-coding one Snowflake form. It pays back on the 2nd–Nth connector; for exactly one connector it would be over-engineering. We accept it because the connector set is explicitly going to grow (F3.2a tranches).
- **Unattended crawl still requires a retained secret — the one honest seam.** ADR-011's "platform holds no credential" is clean for *interactive* OAuth and for the consumer-query path. But a **scheduled background re-crawl** needs the platform to authenticate with no human present, which means retaining a refresh token (OAuth), the PAT, or the private key. The boundary we accept: **no unattended crawl without a retained secret.** A purely interactive, user-present discovery can be credential-free; background freshness cannot. This is a real and acceptable asymmetry with the outbound model, not a contradiction of it.
- **The retained secret must still obey the existing security rule.** Whatever is retained (refresh token, PAT, private key) is stored **only** behind a Secrets Manager ARN (or the `local-env:` sentinel in dev/demo) and **never** raw in `connection_config` — exactly as today. The raw-credential guard (`raw-credential-guard.ts`) continues to enforce this. OAuth/PAT change *what* secret is stored and *how it's obtained*, not *where it lives*.
- **Token expiry vs. unattended crawl tension is inherent.** PATs and OAuth tokens expire; key-pair does not. Connectors used for long-lived unattended crawl may still prefer key-pair (now auto-generated). The platform must surface impending token/grant expiry (the F10.19 expiry-warning machinery is the natural home).

### Phased build

1. **Phase 1 (near-term, days not quarters): PAT + spec-driven guided form + URL parser + check-with-diagnostics.** Reuses the Databricks PAT pattern already in the codebase. This alone closes the bulk of the pain and proves the spec-form engine on a second auth method.
2. **Phase 2: auto-generate the key pair for the key-pair method** (one copy-paste line instead of `openssl` + `ALTER USER`). Small; removes the scariest step for the unattended case.
3. **Phase 3: OAuth "Sign in with Snowflake."** The most elegant and most on-thesis, sequenced last because of the security-integration setup and refresh-token lifecycle. It remains the north star the other phases are *shaped toward* — but it is explicitly **demand-gated, not scheduled.** If phases 1–2 (PAT + guided form + check-with-diagnostics) prove elegant enough in practice, OAuth may be deferred indefinitely. We build toward it without committing to building it; PAT-plus-a-good-form is allowed to be the answer.

---

## Alternatives considered

- **Keep key-pair-only and just write better docs.** Rejected. Documentation cannot fix a persona mismatch or an opaque JSON textarea; the comparable tools didn't win on docs, they won on auth-method choice and guided forms.
- **Hand-code a Snowflake-specific form, skip the spec engine.** Rejected as the *durable* answer (accepted only implicitly as the shape of phase 1's first screen). With a connector set that is explicitly growing, per-type hand-coding is the trap we'd pay for on every future connector.
- **Credential brokerage for inbound (platform mints/holds/rotates a per-connector credential).** Rejected for the same reasons ADR-011 rejected it outbound: months of per-source infrastructure and a control-plane/data-plane entanglement that strains Constraint 3. Configuration-brokerage-plus-a-retained-refresh-token is the lighter, on-thesis path.
- **Make connector registration a pure per-domain self-serve act with no admin role.** Rejected per Decision 5 — it is fiction for the domain-owner persona and misplaces where the credential and expertise actually live.

---

## References

- [ADR-011: Configuration Brokerage](./ADR-011-configuration-brokerage.md) — the outbound mirror of this decision.
- `documents/architecture/snowflake-integration-sketch.md` — the key-pair JWT implementation this ADR proposes to supplement.
- `apps/web/src/features/connectors/ConnectorsPage.tsx` — the raw-JSON form this ADR retires.
- `apps/api/src/connectors/probe/connector-probe.service.ts` — the probe/auth implementation to extend with PAT and OAuth.
- `apps/api/src/connectors/probe/raw-credential-guard.ts` — the never-store-raw-credentials guard that continues to hold.
- Prior art: Airbyte connector `spec` + `check` + `advanced_auth`; Singer/Meltano `--discover`; dbt Snowflake `authenticator: externalbrowser`; Grafana/Metabase test-connection UX.
