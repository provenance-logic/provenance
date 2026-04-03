-- Migration V3: Products schema
-- Data product definitions, lifecycle state, port declarations, and version history.
-- Versions are immutable records — never updated or deleted.

CREATE SCHEMA IF NOT EXISTS products;

-- ---------------------------------------------------------------------------
-- Data products
-- ---------------------------------------------------------------------------
CREATE TABLE products.data_products (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID        NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    domain_id           UUID        NOT NULL REFERENCES organizations.domains(id) ON DELETE RESTRICT,
    name                VARCHAR(120) NOT NULL,
    slug                VARCHAR(63)  NOT NULL,
    description         TEXT,
    status              VARCHAR(32)  NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'published', 'deprecated', 'decommissioned')),
    version             VARCHAR(32)  NOT NULL DEFAULT '0.1.0',
    classification      VARCHAR(32)  NOT NULL
                            CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
    owner_principal_id  UUID        NOT NULL REFERENCES identity.principals(id),
    tags                TEXT[]       NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT data_products_org_domain_slug_unique UNIQUE (org_id, domain_id, slug)
);

CREATE INDEX data_products_org_id_idx ON products.data_products (org_id);
CREATE INDEX data_products_domain_id_idx ON products.data_products (domain_id);
CREATE INDEX data_products_status_idx ON products.data_products (org_id, status);

-- ---------------------------------------------------------------------------
-- Port declarations
-- ---------------------------------------------------------------------------
CREATE TABLE products.port_declarations (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID        NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    product_id      UUID        NOT NULL REFERENCES products.data_products(id) ON DELETE CASCADE,
    port_type       VARCHAR(32)  NOT NULL
                        CHECK (port_type IN ('input', 'output', 'discovery', 'observability', 'control')),
    name            VARCHAR(120) NOT NULL,
    description     TEXT,
    interface_type  VARCHAR(64)
                        CHECK (interface_type IN (
                            'sql_jdbc', 'rest_api', 'graphql', 'streaming_topic',
                            'file_object_export', 'semantic_query_endpoint'
                        )),
    contract_schema JSONB,
    sla_description TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX port_declarations_product_id_idx ON products.port_declarations (product_id);
CREATE INDEX port_declarations_org_id_idx ON products.port_declarations (org_id);

-- ---------------------------------------------------------------------------
-- Product versions (immutable snapshots — no UPDATE permitted)
-- ---------------------------------------------------------------------------
CREATE TABLE products.product_versions (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                  UUID        NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    product_id              UUID        NOT NULL REFERENCES products.data_products(id) ON DELETE RESTRICT,
    version                 VARCHAR(32)  NOT NULL,
    change_description      TEXT,
    snapshot                JSONB       NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by_principal_id UUID        REFERENCES identity.principals(id),

    CONSTRAINT product_versions_product_version_unique UNIQUE (product_id, version)
);

CREATE INDEX product_versions_product_id_idx ON products.product_versions (product_id);
CREATE INDEX product_versions_org_id_idx ON products.product_versions (org_id);

-- Product versions are append-only — revoke UPDATE and DELETE at the DB level.
REVOKE UPDATE, DELETE ON products.product_versions FROM provenance_app;

-- ---------------------------------------------------------------------------
-- Lifecycle events log (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE products.lifecycle_events (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID        NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    product_id      UUID        NOT NULL REFERENCES products.data_products(id) ON DELETE RESTRICT,
    from_status     VARCHAR(32),
    to_status       VARCHAR(32)  NOT NULL,
    triggered_by    UUID        REFERENCES identity.principals(id),
    note            TEXT,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX lifecycle_events_product_id_idx ON products.lifecycle_events (product_id);
CREATE INDEX lifecycle_events_org_id_idx ON products.lifecycle_events (org_id);

REVOKE UPDATE, DELETE ON products.lifecycle_events FROM provenance_app;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
ALTER TABLE products.data_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products.port_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE products.product_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE products.lifecycle_events ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA products TO provenance_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON products.data_products TO provenance_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON products.port_declarations TO provenance_app;
GRANT SELECT, INSERT ON products.product_versions TO provenance_app;
GRANT SELECT, INSERT ON products.lifecycle_events TO provenance_app;

CREATE POLICY data_products_org_isolation ON products.data_products
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

CREATE POLICY port_declarations_org_isolation ON products.port_declarations
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

CREATE POLICY product_versions_org_isolation ON products.product_versions
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

CREATE POLICY lifecycle_events_org_isolation ON products.lifecycle_events
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

-- Triggers
CREATE TRIGGER data_products_updated_at
    BEFORE UPDATE ON products.data_products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER port_declarations_updated_at
    BEFORE UPDATE ON products.port_declarations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
