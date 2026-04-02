-- Migration V1: Organizations schema
-- Creates the organizations PostgreSQL schema with row-level security.
-- Every table carries org_id for multi-tenant isolation.

CREATE SCHEMA IF NOT EXISTS organizations;

-- ---------------------------------------------------------------------------
-- Organizations (tenants)
-- ---------------------------------------------------------------------------
CREATE TABLE organizations.orgs (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(120) NOT NULL,
    slug            VARCHAR(63)  NOT NULL,
    description     TEXT,
    status          VARCHAR(32)  NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'suspended', 'decommissioned')),
    contact_email   VARCHAR(254),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT orgs_slug_unique UNIQUE (slug)
);

-- ---------------------------------------------------------------------------
-- Domains
-- ---------------------------------------------------------------------------
CREATE TABLE organizations.domains (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID        NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    name                VARCHAR(120) NOT NULL,
    slug                VARCHAR(63)  NOT NULL,
    description         TEXT,
    owner_principal_id  UUID        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT domains_org_slug_unique UNIQUE (org_id, slug)
);

CREATE INDEX domains_org_id_idx ON organizations.domains (org_id);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
ALTER TABLE organizations.orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations.domains ENABLE ROW LEVEL SECURITY;

-- Application role used by the NestJS API.
-- Created here if it does not exist; idempotent via DO block.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'meshos_app') THEN
        CREATE ROLE meshos_app;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA organizations TO meshos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA organizations TO meshos_app;

-- Orgs: the app role can see any org (org selection happens at the application layer).
-- In production this will be tightened per-org via a current_setting context variable.
CREATE POLICY orgs_app_policy ON organizations.orgs
    FOR ALL TO meshos_app USING (true);

-- Domains: the app role can only see domains within the current org context.
-- The NestJS API sets meshos.current_org_id on every connection via SET LOCAL.
CREATE POLICY domains_org_isolation ON organizations.domains
    FOR ALL TO meshos_app
    USING (org_id = current_setting('meshos.current_org_id', true)::UUID);

-- ---------------------------------------------------------------------------
-- updated_at trigger (reused across all tables)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER orgs_updated_at
    BEFORE UPDATE ON organizations.orgs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER domains_updated_at
    BEFORE UPDATE ON organizations.domains
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
