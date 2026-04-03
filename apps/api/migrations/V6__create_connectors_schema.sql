-- Migration V6: Connectors schema
-- Connector registrations, source objects, and health monitoring.
-- connector_health_events: append-only — health check history is never modified.
-- schema_snapshots: append-only — schema captures are immutable point-in-time records.
-- Credentials are never stored here. connection_config holds non-sensitive config only.
-- Sensitive credentials are stored in AWS Secrets Manager; credential_arn is the reference.

CREATE SCHEMA IF NOT EXISTS connectors;

-- ---------------------------------------------------------------------------
-- Connectors
-- Authenticated links between the platform control plane and domain-owned
-- data infrastructure. One connector per external system per domain.
-- Credentials are stored exclusively in AWS Secrets Manager — the
-- credential_arn column holds the ARN reference only, never raw values.
-- ---------------------------------------------------------------------------
CREATE TABLE connectors.connectors (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID         NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    domain_id           UUID         NOT NULL REFERENCES organizations.domains(id) ON DELETE RESTRICT,
    name                VARCHAR(120) NOT NULL,
    description         TEXT,
    connector_type      VARCHAR(64)  NOT NULL
                            CHECK (connector_type IN (
                                'postgresql', 'mysql', 'snowflake', 'bigquery',
                                'redshift', 'databricks', 's3', 'gcs', 'azure_blob',
                                'kafka', 'redpanda', 'rest_api', 'custom'
                            )),
    connection_config   JSONB        NOT NULL DEFAULT '{}',  -- non-sensitive: host, port, db, ssl mode, etc.
    credential_arn      VARCHAR(2048),                       -- AWS Secrets Manager ARN; NULL for public sources
    validation_status   VARCHAR(32)  NOT NULL DEFAULT 'pending'
                            CHECK (validation_status IN ('pending', 'valid', 'invalid', 'stale')),
    last_validated_at   TIMESTAMPTZ,
    created_by          UUID         NOT NULL REFERENCES identity.principals(id),
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT connectors_org_domain_name_unique UNIQUE (org_id, domain_id, name)
);

CREATE INDEX connectors_org_id_idx     ON connectors.connectors (org_id);
CREATE INDEX connectors_domain_id_idx  ON connectors.connectors (domain_id);
CREATE INDEX connectors_status_idx     ON connectors.connectors (org_id, validation_status);

-- ---------------------------------------------------------------------------
-- Connector health events
-- Append-only log of health check results. One row per check execution.
-- The Observability API reads this table to compute connector health signals.
-- Published to the connector.health Redpanda topic for downstream consumers.
-- ---------------------------------------------------------------------------
CREATE TABLE connectors.connector_health_events (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           UUID         NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    connector_id     UUID         NOT NULL REFERENCES connectors.connectors(id) ON DELETE CASCADE,
    status           VARCHAR(32)  NOT NULL
                         CHECK (status IN ('healthy', 'degraded', 'unreachable', 'credential_error', 'timeout')),
    response_time_ms INTEGER,                 -- NULL if connection did not complete
    error_message    TEXT,                    -- NULL on healthy checks
    checked_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX connector_health_events_connector_idx  ON connectors.connector_health_events (connector_id, checked_at DESC);
CREATE INDEX connector_health_events_org_idx        ON connectors.connector_health_events (org_id, checked_at DESC);

-- Append-only — health check history is never modified.
REVOKE UPDATE, DELETE ON connectors.connector_health_events FROM provenance_app;

-- ---------------------------------------------------------------------------
-- Source registrations
-- A registered source object within a connector — a specific table, view,
-- topic, S3 prefix, or API endpoint that a data product input port can
-- reference. Owned by the domain that owns the connector.
-- ---------------------------------------------------------------------------
CREATE TABLE connectors.source_registrations (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID         NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    connector_id    UUID         NOT NULL REFERENCES connectors.connectors(id) ON DELETE RESTRICT,
    source_ref      VARCHAR(500) NOT NULL,    -- e.g. "public.users", "s3://bucket/prefix/", "orders.v1"
    source_type     VARCHAR(64)  NOT NULL
                        CHECK (source_type IN (
                            'table', 'view', 'materialized_view',
                            'topic', 's3_prefix', 'api_endpoint', 'custom'
                        )),
    display_name    VARCHAR(120) NOT NULL,
    description     TEXT,
    registered_by   UUID         NOT NULL REFERENCES identity.principals(id),
    registered_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT source_registrations_connector_ref_unique UNIQUE (connector_id, source_ref)
);

CREATE INDEX source_registrations_connector_idx ON connectors.source_registrations (connector_id);
CREATE INDEX source_registrations_org_id_idx    ON connectors.source_registrations (org_id);

-- ---------------------------------------------------------------------------
-- Schema snapshots
-- Immutable point-in-time captures of a source's inferred schema.
-- One snapshot per (source_registration, captured_at). Never updated or deleted.
-- The latest snapshot per source is used for schema inference in port authoring.
-- ---------------------------------------------------------------------------
CREATE TABLE connectors.schema_snapshots (
    id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                  UUID         NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    source_registration_id  UUID         NOT NULL REFERENCES connectors.source_registrations(id) ON DELETE RESTRICT,
    connector_id            UUID         NOT NULL REFERENCES connectors.connectors(id) ON DELETE RESTRICT,
    schema_definition       JSONB        NOT NULL,   -- inferred column/field names, types, nullability
    column_count            INTEGER,
    row_estimate            BIGINT,                  -- NULL for non-tabular sources
    captured_by             UUID         REFERENCES identity.principals(id),   -- NULL for automated captures
    captured_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX schema_snapshots_source_reg_idx ON connectors.schema_snapshots (source_registration_id, captured_at DESC);
CREATE INDEX schema_snapshots_org_id_idx     ON connectors.schema_snapshots (org_id);

-- Append-only — schema captures are immutable historical records.
REVOKE UPDATE, DELETE ON connectors.schema_snapshots FROM provenance_app;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
ALTER TABLE connectors.connectors              ENABLE ROW LEVEL SECURITY;
ALTER TABLE connectors.connector_health_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE connectors.source_registrations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE connectors.schema_snapshots        ENABLE ROW LEVEL SECURITY;

-- Permissions — event/snapshot tables exclude UPDATE and DELETE.
GRANT USAGE ON SCHEMA connectors TO provenance_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON connectors.connectors           TO provenance_app;
GRANT SELECT, INSERT                 ON connectors.connector_health_events TO provenance_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON connectors.source_registrations TO provenance_app;
GRANT SELECT, INSERT                 ON connectors.schema_snapshots     TO provenance_app;

CREATE POLICY connectors_org_isolation ON connectors.connectors
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

CREATE POLICY connector_health_events_org_isolation ON connectors.connector_health_events
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

CREATE POLICY source_registrations_org_isolation ON connectors.source_registrations
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

CREATE POLICY schema_snapshots_org_isolation ON connectors.schema_snapshots
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

-- ---------------------------------------------------------------------------
-- updated_at triggers — mutable tables only.
-- connector_health_events and schema_snapshots are append-only; no trigger needed.
-- ---------------------------------------------------------------------------
CREATE TRIGGER connectors_updated_at
    BEFORE UPDATE ON connectors.connectors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER source_registrations_updated_at
    BEFORE UPDATE ON connectors.source_registrations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
