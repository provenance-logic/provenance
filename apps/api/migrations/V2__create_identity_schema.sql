-- Migration V2: Identity schema
-- Stores platform-specific principal metadata.
-- Keycloak is the authentication source; this table stores Provenance platform metadata only.

CREATE SCHEMA IF NOT EXISTS identity;

-- ---------------------------------------------------------------------------
-- Principals
-- ---------------------------------------------------------------------------
CREATE TABLE identity.principals (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID        NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    principal_type      VARCHAR(32)  NOT NULL
                            CHECK (principal_type IN ('human_user', 'service_account', 'ai_agent', 'platform_admin')),
    keycloak_subject    VARCHAR(255) NOT NULL,
    email               VARCHAR(254),
    display_name        VARCHAR(255),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT principals_keycloak_subject_unique UNIQUE (keycloak_subject)
);

CREATE INDEX principals_org_id_idx ON identity.principals (org_id);

-- ---------------------------------------------------------------------------
-- Roles and role assignments
-- ---------------------------------------------------------------------------
CREATE TABLE identity.role_assignments (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID        NOT NULL REFERENCES organizations.orgs(id) ON DELETE CASCADE,
    principal_id    UUID        NOT NULL REFERENCES identity.principals(id) ON DELETE CASCADE,
    role            VARCHAR(64)  NOT NULL
                        CHECK (role IN ('org_admin', 'domain_owner', 'data_product_owner', 'consumer', 'governance_member')),
    domain_id       UUID,   -- NULL means org-level role; non-NULL scopes the role to a domain
    granted_by      UUID    REFERENCES identity.principals(id),
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT role_assignments_unique UNIQUE (org_id, principal_id, role, domain_id)
);

CREATE INDEX role_assignments_org_principal_idx ON identity.role_assignments (org_id, principal_id);

-- ---------------------------------------------------------------------------
-- Agent identities (Phase 4 — table created now to keep schema coherent)
-- ---------------------------------------------------------------------------
CREATE TABLE identity.agent_identities (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                      UUID        NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    principal_id                UUID        NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    display_name                VARCHAR(255) NOT NULL,
    model_id                    VARCHAR(255) NOT NULL,
    model_version               VARCHAR(64),
    trust_classification        VARCHAR(32)  NOT NULL DEFAULT 'observed'
                                    CHECK (trust_classification IN ('observed', 'supervised', 'autonomous')),
    human_oversight_contact_id  UUID        REFERENCES identity.principals(id),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT agent_identities_principal_unique UNIQUE (principal_id)
);

CREATE INDEX agent_identities_org_id_idx ON identity.agent_identities (org_id);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
ALTER TABLE identity.principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.agent_identities ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA identity TO provenance_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA identity TO provenance_app;

CREATE POLICY principals_org_isolation ON identity.principals
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

CREATE POLICY role_assignments_org_isolation ON identity.role_assignments
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

CREATE POLICY agent_identities_org_isolation ON identity.agent_identities
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

-- Triggers
CREATE TRIGGER principals_updated_at
    BEFORE UPDATE ON identity.principals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER agent_identities_updated_at
    BEFORE UPDATE ON identity.agent_identities
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
