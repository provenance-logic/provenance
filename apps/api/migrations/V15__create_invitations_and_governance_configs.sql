-- Migration V15: Invitations and governance configs
--
-- identity.invitations:
--   Pending invitations sent by org admins (F10.3 — Domain 10 self-serve).
--   Token-bearing links are emailed to prospective members; on acceptance the
--   invitee's principal row is created (or reused) and the pre-assigned role is
--   granted. Expired invitations are re-sendable without creating duplicates —
--   enforced by a partial unique index on active (unconsumed) rows.
--
-- organizations.governance_configs:
--   Per-org governance settings keyed by string. Used today for invitation TTL;
--   extensible to any future governance-configurable value (F10.3 — governance-
--   configurable invitation TTL). Referenced as a planned schema element in
--   CLAUDE.md / PRD v1.4 but not previously materialized.

-- ---------------------------------------------------------------------------
-- organizations.governance_configs
-- ---------------------------------------------------------------------------
CREATE TABLE organizations.governance_configs (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID        NOT NULL REFERENCES organizations.orgs(id) ON DELETE CASCADE,
    config_key  VARCHAR(128) NOT NULL,
    value_json  JSONB       NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT governance_configs_org_key_unique UNIQUE (org_id, config_key)
);

CREATE INDEX governance_configs_org_id_idx ON organizations.governance_configs (org_id);

ALTER TABLE organizations.governance_configs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON organizations.governance_configs TO provenance_app;

CREATE POLICY governance_configs_org_isolation ON organizations.governance_configs
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

CREATE TRIGGER governance_configs_updated_at
    BEFORE UPDATE ON organizations.governance_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- identity.invitations
-- ---------------------------------------------------------------------------
CREATE TABLE identity.invitations (
    id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                    UUID        NOT NULL REFERENCES organizations.orgs(id) ON DELETE CASCADE,
    email                     VARCHAR(254) NOT NULL,
    role                      VARCHAR(64)  NOT NULL
                                  CHECK (role IN ('org_admin', 'domain_owner', 'data_product_owner', 'consumer', 'governance_member')),
    domain_id                 UUID         REFERENCES organizations.domains(id) ON DELETE CASCADE,
    invited_by_principal_id   UUID        NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    token                     VARCHAR(128) NOT NULL,
    expires_at                TIMESTAMPTZ NOT NULL,
    consumed_at               TIMESTAMPTZ,
    resend_count              INTEGER     NOT NULL DEFAULT 0,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT invitations_token_unique UNIQUE (token)
);

CREATE INDEX invitations_org_id_idx       ON identity.invitations (org_id);
CREATE INDEX invitations_email_idx        ON identity.invitations (email);
CREATE INDEX invitations_expires_at_idx   ON identity.invitations (expires_at);

-- Only one active (unconsumed) invitation per (org, email, role, domain) combination.
-- Expired-but-unconsumed invitations remain queryable and re-sendable.
CREATE UNIQUE INDEX invitations_active_unique
    ON identity.invitations (org_id, email, role, COALESCE(domain_id, '00000000-0000-0000-0000-000000000000'::uuid))
    WHERE consumed_at IS NULL;

ALTER TABLE identity.invitations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON identity.invitations TO provenance_app;

-- Public acceptance lookups bypass the org_id RLS (the token itself is the
-- proof of authorization). The service layer sets
-- provenance.current_org_id before writing; the public endpoint uses a
-- session variable override to look up a row by token alone.
CREATE POLICY invitations_org_isolation ON identity.invitations
    FOR ALL TO provenance_app
    USING (
        org_id = current_setting('provenance.current_org_id', true)::UUID
        OR current_setting('provenance.invitation_lookup_mode', true) = 'token'
    );
