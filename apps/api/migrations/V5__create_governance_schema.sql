-- Migration V5: Governance schema
-- Policy artifacts, effective policy computation, and compliance tracking.
-- policy_versions: DELETE revoked — published policy artifacts are permanent records.
-- compliance_states, exceptions, grace_periods: mutable — updated in-place.
-- All event history is preserved through the audit log (V4).

CREATE SCHEMA IF NOT EXISTS governance;

-- Policy domain enum used across multiple tables.
-- Defined as a CHECK inline rather than a PostgreSQL TYPE to keep migrations
-- additive-only (adding a value to a TYPE requires ALTER TYPE, which holds a lock).

-- ---------------------------------------------------------------------------
-- Policy schemas
-- Defines the available rule types and their parameter shapes for each policy
-- domain. Platform defaults are seeded by the application on first boot.
-- Org-level overrides can extend the default schema for custom rule types.
-- ---------------------------------------------------------------------------
CREATE TABLE governance.policy_schemas (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID         NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    policy_domain       VARCHAR(64)  NOT NULL
                            CHECK (policy_domain IN (
                                'product_schema', 'classification_taxonomy',
                                'versioning_deprecation', 'access_control',
                                'lineage', 'slo', 'agent_access', 'interoperability'
                            )),
    schema_version      VARCHAR(32)  NOT NULL DEFAULT '1.0.0',
    schema_definition   JSONB        NOT NULL,   -- JSONSchema for rules in this domain
    is_platform_default BOOLEAN      NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX policy_schemas_org_domain_idx ON governance.policy_schemas (org_id, policy_domain);

-- ---------------------------------------------------------------------------
-- Policy versions
-- Immutable published policy artifacts. One version per (org, domain, number).
-- DELETE is revoked — published artifacts must be preserved for compliance audits.
-- UPDATE is permitted only to set rego_bundle_ref after OPA bundle compilation.
-- The rules JSONB is never modified after INSERT.
-- ---------------------------------------------------------------------------
CREATE TABLE governance.policy_versions (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            UUID         NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    policy_domain     VARCHAR(64)  NOT NULL
                          CHECK (policy_domain IN (
                              'product_schema', 'classification_taxonomy',
                              'versioning_deprecation', 'access_control',
                              'lineage', 'slo', 'agent_access', 'interoperability'
                          )),
    version_number    INTEGER      NOT NULL,    -- monotonically increasing per (org, domain)
    rules             JSONB        NOT NULL,    -- immutable: the authored governance rules
    description       TEXT,
    published_by      UUID         NOT NULL REFERENCES identity.principals(id),
    published_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    rego_bundle_ref   VARCHAR(2048),            -- S3/MinIO path to the compiled OPA bundle;
                                               -- set after async compilation, NULL until ready

    CONSTRAINT policy_versions_org_domain_number_unique UNIQUE (org_id, policy_domain, version_number)
);

CREATE INDEX policy_versions_org_domain_idx ON governance.policy_versions (org_id, policy_domain);

-- Revoke DELETE — published policy artifacts are permanent records.
REVOKE DELETE ON governance.policy_versions FROM provenance_app;

-- ---------------------------------------------------------------------------
-- Effective policies
-- Computed effective policy per domain and scope. Mutable — recalculated on
-- every policy publish event and whenever a domain extension is added.
--
-- scope_type = 'global_floor': one row per (org, domain); scope_id IS NULL.
-- scope_type = 'domain_extension': one row per (org, domain, domain_id).
--
-- computed_rules holds the union of the floor and all applicable extensions
-- for this scope — the single JSONB evaluated by OPA at enforcement time.
-- ---------------------------------------------------------------------------
CREATE TABLE governance.effective_policies (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            UUID         NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    policy_domain     VARCHAR(64)  NOT NULL
                          CHECK (policy_domain IN (
                              'product_schema', 'classification_taxonomy',
                              'versioning_deprecation', 'access_control',
                              'lineage', 'slo', 'agent_access', 'interoperability'
                          )),
    scope_type        VARCHAR(32)  NOT NULL
                          CHECK (scope_type IN ('global_floor', 'domain_extension')),
    scope_id          UUID,                    -- NULL for global_floor; domain UUID for extensions
    policy_version_id UUID         NOT NULL REFERENCES governance.policy_versions(id),
    computed_rules    JSONB        NOT NULL,
    computed_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Partial unique indexes handle NULL scope_id correctly.
-- A standard UNIQUE constraint treats NULL != NULL so multiple nulls would pass;
-- the partial index with WHERE restricts the relevant rows explicitly.
CREATE UNIQUE INDEX effective_policies_global_unique
    ON governance.effective_policies (org_id, policy_domain)
    WHERE scope_type = 'global_floor';

CREATE UNIQUE INDEX effective_policies_domain_unique
    ON governance.effective_policies (org_id, policy_domain, scope_id)
    WHERE scope_type = 'domain_extension';

CREATE INDEX effective_policies_org_domain_idx
    ON governance.effective_policies (org_id, policy_domain);

-- ---------------------------------------------------------------------------
-- Compliance states
-- Current compliance state per published data product. One row per (org, product).
-- Updated in-place on every evaluation cycle and on trigger events.
-- State transitions are recorded in the audit log (V4).
-- violations: JSONB array of { policy_domain, rule_id, detail } objects.
-- ---------------------------------------------------------------------------
CREATE TABLE governance.compliance_states (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID         NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    product_id          UUID         NOT NULL REFERENCES products.data_products(id) ON DELETE CASCADE,
    state               VARCHAR(32)  NOT NULL DEFAULT 'compliant'
                            CHECK (state IN ('compliant', 'drift_detected', 'grace_period', 'non_compliant')),
    violations          JSONB        NOT NULL DEFAULT '[]',
    policy_version_id   UUID         REFERENCES governance.policy_versions(id),
    evaluated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    next_evaluation_at  TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT compliance_states_org_product_unique UNIQUE (org_id, product_id)
);

CREATE INDEX compliance_states_org_id_idx   ON governance.compliance_states (org_id);
CREATE INDEX compliance_states_state_idx    ON governance.compliance_states (org_id, state);
CREATE INDEX compliance_states_eval_idx     ON governance.compliance_states (next_evaluation_at)
    WHERE next_evaluation_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Exceptions
-- Governance-granted exceptions allowing a product to operate in a non-compliant
-- state for a bounded period. Revocable at any time by a governance member.
-- ---------------------------------------------------------------------------
CREATE TABLE governance.exceptions (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            UUID         NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    product_id        UUID         NOT NULL REFERENCES products.data_products(id) ON DELETE CASCADE,
    policy_domain     VARCHAR(64)  NOT NULL
                          CHECK (policy_domain IN (
                              'product_schema', 'classification_taxonomy',
                              'versioning_deprecation', 'access_control',
                              'lineage', 'slo', 'agent_access', 'interoperability'
                          )),
    policy_version_id UUID         REFERENCES governance.policy_versions(id),
    exception_reason  TEXT         NOT NULL,
    granted_by        UUID         NOT NULL REFERENCES identity.principals(id),
    granted_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at        TIMESTAMPTZ  NOT NULL,
    revoked_at        TIMESTAMPTZ,
    revoked_by        UUID         REFERENCES identity.principals(id),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX exceptions_org_product_idx ON governance.exceptions (org_id, product_id);
-- Partial index for fast active-exception lookups at enforcement time.
CREATE INDEX exceptions_active_idx ON governance.exceptions (org_id, expires_at)
    WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Grace periods
-- Time-bounded remediation windows opened when a breaking policy change makes
-- existing compliant products non-compliant. Each grace period is tracked by
-- a Temporal workflow that transitions compliance state when the deadline passes.
-- ---------------------------------------------------------------------------
CREATE TABLE governance.grace_periods (
    id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id               UUID         NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    product_id           UUID         NOT NULL REFERENCES products.data_products(id) ON DELETE CASCADE,
    policy_domain        VARCHAR(64)  NOT NULL
                             CHECK (policy_domain IN (
                                 'product_schema', 'classification_taxonomy',
                                 'versioning_deprecation', 'access_control',
                                 'lineage', 'slo', 'agent_access', 'interoperability'
                             )),
    policy_version_id    UUID         NOT NULL REFERENCES governance.policy_versions(id),
    ends_at              TIMESTAMPTZ  NOT NULL,
    temporal_workflow_id VARCHAR(255),          -- Temporal workflow ID tracking this timer
    started_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    ended_at             TIMESTAMPTZ,           -- NULL while pending
    outcome              VARCHAR(32)  NOT NULL DEFAULT 'pending'
                             CHECK (outcome IN ('pending', 'compliant', 'escalated')),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX grace_periods_org_product_idx ON governance.grace_periods (org_id, product_id);
-- Partial index for fast active-grace-period lookups at evaluation time.
CREATE INDEX grace_periods_active_idx ON governance.grace_periods (org_id, ends_at)
    WHERE outcome = 'pending';

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
ALTER TABLE governance.policy_schemas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance.policy_versions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance.effective_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance.compliance_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance.exceptions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance.grace_periods     ENABLE ROW LEVEL SECURITY;

-- Permissions — policy_versions excludes DELETE (revoked above).
GRANT USAGE ON SCHEMA governance TO provenance_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON governance.policy_schemas    TO provenance_app;
GRANT SELECT, INSERT, UPDATE         ON governance.policy_versions   TO provenance_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON governance.effective_policies TO provenance_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON governance.compliance_states TO provenance_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON governance.exceptions        TO provenance_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON governance.grace_periods     TO provenance_app;

CREATE POLICY policy_schemas_org_isolation ON governance.policy_schemas
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

CREATE POLICY policy_versions_org_isolation ON governance.policy_versions
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

CREATE POLICY effective_policies_org_isolation ON governance.effective_policies
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

CREATE POLICY compliance_states_org_isolation ON governance.compliance_states
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

CREATE POLICY exceptions_org_isolation ON governance.exceptions
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

CREATE POLICY grace_periods_org_isolation ON governance.grace_periods
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

-- ---------------------------------------------------------------------------
-- updated_at triggers — mutable tables only.
-- policy_versions uses published_at as its sole timestamp (rules are immutable).
-- ---------------------------------------------------------------------------
CREATE TRIGGER policy_schemas_updated_at
    BEFORE UPDATE ON governance.policy_schemas
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER effective_policies_updated_at
    BEFORE UPDATE ON governance.effective_policies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER compliance_states_updated_at
    BEFORE UPDATE ON governance.compliance_states
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER exceptions_updated_at
    BEFORE UPDATE ON governance.exceptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER grace_periods_updated_at
    BEFORE UPDATE ON governance.grace_periods
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
