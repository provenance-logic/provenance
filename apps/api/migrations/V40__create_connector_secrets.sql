-- Migration V40: Connector credential vault (ADR-013)
--
-- Creates connectors.connector_secrets — the built-in encrypted-at-rest
-- store that backs the new `vault:<uuid>` credential reference scheme.
--
-- Why: today a domain owner cannot supply a connector credential through
-- the GUI — the only paths are a pre-staged AWS Secrets Manager ARN or
-- the `local-env:VARNAME` dev sentinel, both requiring operator access.
-- This table lets the platform receive a secret over TLS, encrypt it with
-- AES-256-GCM (EncryptionService, same key source as Domain 10 connection
-- details), persist only the envelope, and hand back a `vault:<uuid>`
-- reference. The connector's `credential_arn` column stores that reference
-- like any other scheme; resolution is scheme-dispatched at probe time.
--
-- Security invariants (must hold at every layer):
--   - No plaintext column — ever. `envelope` is the JSONB EncryptedEnvelope
--     (version, iv, authTag, ciphertext all base64), never the raw secret.
--   - org_id on every row; every query MUST filter on org_id (ESLint
--     provenance/require-org-filter enforces this at ERROR level for TypeORM).
--   - At rest: AES-256-GCM only. Same key source as CONNECTION_DETAILS_* env.
--
-- Rotation: when a user updates a connector's credential the service calls
-- vault.store with the existing ref → the envelope row is overwritten
-- (UPDATE, same UUID), not appended. There is no history of past secrets.

BEGIN;

CREATE TABLE connectors.connector_secrets (
    id         UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id     UUID        NOT NULL,
    envelope   JSONB       NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index so vault.resolve(orgId, id) can do a PK + org_id lookup without
-- a sequential scan (the PK covers id; this partial gives the org_id filter
-- its own path without a composite PK, keeping the PK single-column).
CREATE INDEX connector_secrets_org_id_idx
    ON connectors.connector_secrets (org_id);

COMMIT;
