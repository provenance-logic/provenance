# ADR-013: Connector Credentials — Self-Service Secret Entry, Encrypted at Rest

**Date:** May 25, 2026
**Status:** Accepted (2026-05-25). **Supersedes** the security rule "connector credentials are stored as AWS Secrets Manager ARN references only — never raw values" (CLAUDE.md Security Rules + Phase-5 framing) and **corrects** ADR-012's implicit assumption that the reference-only model was usable for self-service registration.
**Author:** Provenance Platform Team

---

## Resolves

Connector registration is not actually self-service. A domain owner can fill out the (newly guided, ADR-012) form, but at the credential step they hit a wall: the only ways to supply a credential are

1. a **pre-staged AWS Secrets Manager ARN** — requires AWS console access and Secrets Manager permissions the user almost never has, or
2. the **`local-env:VARNAME` sentinel** — requires shell access on the API server to set an environment variable, plus a redeploy.

Both require an operator. `local-env` was only ever a laptop-dev convenience; surfacing it as a credential path for real users was a mistake. **Provenance bills itself as a self-service, multi-tenant data mesh** — a domain team must be able to onboard a connector without anyone touching a server.

Every comparable tool — Palantir Foundry, Fivetran, Airbyte, Metabase, Superset, Grafana, dbt Cloud, Dagster — lets the user **paste the secret directly in the UI**. None require setting an environment variable or running a CLI. The current design is an outlier, and it makes the platform's central promise false at the connector layer.

---

## Context

**The apparent collision.** Two things we held could not both stand:

- *Self-service* requires the user to enter the secret **in the GUI**.
- The existing rule said the platform persists credentials **as ARN references only — never the raw value**.

**The resolution: these were never actually in conflict.** "Enter it in the UI" and "store it securely" are independent. Foundry lets you paste a token *and* encrypts it at rest and never echoes it back. The sound part of the old rule — *never persist plaintext, never log it* — is correct and stays. The broken part — *the user must pre-stage the secret in a vault and hand us only a pointer* — is what made registration non-self-service, and it goes.

So the platform should **receive** the secret (over TLS, in memory), **vault it** (encrypt at rest), and **persist only a reference** — never the plaintext, never a log line. The raw value transits the API exactly once, the way it does in every connector tool.

**Provenance is open source and self-hosted.** A vault that only writes to AWS Secrets Manager would re-break self-service for the large set of deployments that don't run on AWS or don't grant Secrets Manager access. The credential store must therefore be **pluggable**, with a **built-in encrypted store as the default** so a stock `docker compose` deployment is self-service out of the box.

**We already have the crypto.** `apps/api/src/common/encryption.service.ts` is an AES-256-GCM `EncryptionService` (JSON-in → versioned `{iv, authTag, ciphertext}` envelope-out) built for Domain 10 connection-details (F10.6). It never logs the key, plaintext, or ciphertext, and sources its key from `CONNECTION_DETAILS_SECRET_ARN` (prod) or `CONNECTION_DETAILS_DEV_KEY` (dev). The built-in vault reuses it — this is wiring, not new cryptography.

**Relationship to ADR-011 (configuration brokerage).** ADR-011 settled the *consumer / outbound* side: the consumer queries with their own identity; the platform brokers configuration, not credentials. **Inbound connector discovery is the opposite direction** — the platform must authenticate to the source to crawl it unattended, so it genuinely must hold a credential. Vaulting inbound credentials is therefore consistent with ADR-011, not a reversal: outbound stays credential-free; inbound vaults what it must, encrypted, by reference.

**Relationship to ADR-012.** ADR-012 (slices 1–2 shipped) delivered the guided form + PAT/key-pair auth, but assumed the existing credential-reference field was a usable intake. It isn't. This ADR supplies the missing intake and is the actual finish line for "humane registration." OAuth (ADR-012 Decision 2.A) remains the eventual *no-stored-secret* north star for the interactive case; this ADR makes self-service real **today** for PAT / key-pair / token, without waiting on OAuth.

---

## Decision

### 1. The user enters the secret in the GUI

The connector form gets a real **secret field** (masked input). The user pastes the actual credential — a Snowflake PAT, a key-pair JSON, a Databricks token. The browser sends it to the API over TLS. The API **never** returns it, logs it, or stores it in plaintext.

### 2. The platform vaults the secret and persists only a reference

On register/update, the API encrypts the submitted secret and stores the envelope, then sets the connector's `credentialArn` to a **`vault:<uuid>`** reference. Three reference schemes are now understood by credential resolution:

| Scheme | Meaning | Primary use |
| --- | --- | --- |
| `vault:<uuid>` | Platform-managed encrypted store (this ADR) | **Self-service GUI entry — the default** |
| `arn:aws:secretsmanager:…` | AWS Secrets Manager | Cloud deployments / ops who pre-stage in AWS |
| `local-env:VARNAME` | Read from `process.env` | **Dev/test only** — never a user-facing path |

### 3. Pluggable vault; built-in encrypted store is the default

The `vault:` backend is an interface. The **default implementation** persists the `EncryptionService` envelope in a new org-scoped table (`connectors.connector_secrets`), so a stock self-hosted deployment is self-service with no AWS dependency. A Secrets-Manager-backed implementation is the cloud option (the API can `CreateSecret` on the user's behalf and store the resulting `arn:` reference instead). Selection is by configuration, not by code change at call sites.

### 4. The security rule is amended (not abandoned)

> **Old:** "Connector credentials are stored as AWS Secrets Manager ARN references only — never raw values."
>
> **New:** "The platform may receive a connector credential in order to vault it, but **must never persist the plaintext** (no plaintext column, table, cache, or log line) and **must never return it** to any client. Credentials are encrypted at rest (AES-256-GCM) and referenced by `vault:` / `arn:` / `local-env:`. `connectionConfig` must still never contain raw credentials — the `raw-credential-guard` `FORBIDDEN_KEYS` check is unchanged."

The guard's `isValidCredentialArn` is extended to accept `vault:<uuid>`; its `detectRawCredentialKey` (which keeps raw secrets out of `connectionConfig`) is untouched.

### 5. Decrypt only at use, scoped to the org

The `vault:` secret is decrypted only inside the probe / schema / crawl path, only for the owning org, and the plaintext lives no longer than the connection attempt. Same lifetime discipline the rule always intended.

---

## Consequences

### Positive

- **Registration becomes genuinely self-service** — paste the secret, save, done; no AWS, no shell, no operator. This is the actual close of the "humane registration" epic.
- **Self-hosted/OSS works out of the box** — the built-in encrypted store needs no cloud dependency.
- **Reuses audited crypto** (`EncryptionService`) rather than rolling new — smaller surface, faster, consistent with Domain 10.
- **Consistent with ADR-011** once the inbound/outbound distinction is named.

### Costs / risks (stated plainly)

- **The platform now holds encrypted inbound credentials.** Key management matters: the built-in store is only as strong as `CONNECTION_DETAILS_*`. The `CONNECTION_DETAILS_DEV_KEY` is a throwaway dev key — real deployments must set a real key/ARN (already true for Domain 10). Document this in the deploy guide.
- **No key rotation / re-encryption tooling yet** — out of scope here; a follow-up if/when keys rotate.
- **The secret transits the API in memory** during register — unavoidable and standard; mitigated by TLS, no-log discipline, and never persisting plaintext.
- **Credential rotation by the user** (replacing a secret) must overwrite the vault entry, not append — handled in the update path.

### Security posture (must hold in implementation)

- Plaintext secret: never in a DB column, never in a log, never in an API response, never in `connectionConfig`.
- At rest: AES-256-GCM envelope only, in an org-scoped table with the standard `orgId` filter (ESLint `provenance/require-org-filter`).
- The register/update response returns only the `vault:<uuid>` reference (or nothing), never the secret.

---

## Implementation outline (this ADR's build)

Spec-first / migration-first / test-first, per the repo conventions:

1. **Migration** — `connectors.connector_secrets` (`id uuid pk`, `org_id uuid`, `envelope jsonb`, `created_at`, `updated_at`), org-scoped.
2. **Vault service** — `ConnectorCredentialVaultService` (default: `EncryptionService` + the new repo). `store(orgId, secretJson) → vault:<uuid>`; `resolve(orgId, "vault:<uuid>") → secretJson`; overwrite on update.
3. **Resolution** — credential resolution learns `vault:` (alongside `arn:` / `local-env:`), so the probe/schema/crawl path is unchanged at its call sites.
4. **Guard** — `isValidCredentialArn` accepts `vault:<uuid>`.
5. **API** — register/update accept an optional raw `credentialSecret` (object); when present, vault it and set `credentialArn = vault:<id>`; never echo it. OpenAPI updated (spec-first); types regenerated.
6. **Frontend** — the credential field becomes a masked secret input that submits `credentialSecret` (the actual token/JSON), replacing the "paste an ARN/`local-env`" reference box for the self-service path. ARN entry remains available as an advanced option.
7. **Docs** — amend the CLAUDE.md security rule per Decision 4; note `CONNECTION_DETAILS_*` is now also the connector-credential key.
8. **Tests** — vault round-trip; never-persist-plaintext assertion; `vault:` resolution in the probe; guard accepts `vault:`; register/update vault-and-reference; response never contains the secret.

---

## References

- [ADR-011: Configuration Brokerage](./ADR-011-configuration-brokerage.md) — the outbound mirror; this ADR is the inbound counterpart.
- [ADR-012: Connector Auth + Guided Registration](./ADR-012-connector-auth-and-guided-registration.md) — supplies the guided form + PAT auth this ADR completes.
- `apps/api/src/common/encryption.service.ts` — the AES-256-GCM service the built-in vault reuses.
- `apps/api/src/connectors/probe/raw-credential-guard.ts` / `secrets-manager.service.ts` — the guard + resolution this ADR extends.
