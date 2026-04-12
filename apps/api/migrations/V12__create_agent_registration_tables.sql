-- Migration V12: Agent registration tables
-- Replaces the Phase 4 placeholder agent_identities from V2 with the full
-- agent registration schema, and adds agent_trust_classifications as an
-- immutable classification history table required for audit.

-- ---------------------------------------------------------------------------
-- Drop old placeholder table (empty — no data loss)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS identity.agent_identities;

-- ---------------------------------------------------------------------------
-- Agent identities — registered agent identity records
-- ---------------------------------------------------------------------------
CREATE TABLE identity.agent_identities (
    agent_id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                      UUID        NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    display_name                VARCHAR(255) NOT NULL,
    model_name                  VARCHAR(255) NOT NULL,
    model_provider              VARCHAR(255) NOT NULL,
    human_oversight_contact     VARCHAR(255) NOT NULL,
    registered_by_principal_id  UUID        NOT NULL,
    current_classification      VARCHAR(50),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX agent_identities_org_id_idx ON identity.agent_identities (org_id);

-- ---------------------------------------------------------------------------
-- Agent trust classifications — immutable history of classification changes.
-- Each row is a point-in-time record. Never updated or deleted.
-- ---------------------------------------------------------------------------
CREATE TABLE identity.agent_trust_classifications (
    classification_id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id                    UUID        NOT NULL REFERENCES identity.agent_identities(agent_id) ON DELETE RESTRICT,
    org_id                      UUID        NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    classification              VARCHAR(50) NOT NULL
                                    CHECK (classification IN ('Observed', 'Supervised', 'Autonomous')),
    scope                       VARCHAR(50) NOT NULL DEFAULT 'global',
    changed_by_principal_id     UUID        NOT NULL,
    changed_by_principal_type   VARCHAR(50) NOT NULL
                                    CHECK (changed_by_principal_type IN ('human_user', 'governance_role')),
    reason                      VARCHAR(1000) NOT NULL,
    effective_from              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary query pattern: fetch current classification for an agent
CREATE INDEX agent_trust_classifications_agent_effective_idx
    ON identity.agent_trust_classifications (agent_id, effective_from DESC);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
ALTER TABLE identity.agent_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.agent_trust_classifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_identities_org_isolation ON identity.agent_identities
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

CREATE POLICY agent_trust_classifications_org_isolation ON identity.agent_trust_classifications
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
CREATE TRIGGER agent_identities_updated_at
    BEFORE UPDATE ON identity.agent_identities
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
