-- Migration V4: Audit schema
-- Append-only audit log partitioned by month.
-- No UPDATE or DELETE permissions granted at any level — ever.

CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE audit.audit_log (
    id              UUID        NOT NULL DEFAULT gen_random_uuid(),
    org_id          UUID        NOT NULL,
    principal_id    UUID,
    principal_type  VARCHAR(32),
    action          VARCHAR(128) NOT NULL,
    resource_type   VARCHAR(64)  NOT NULL,
    resource_id     UUID,
    old_value       JSONB,
    new_value       JSONB,
    metadata        JSONB,
    ip_address      INET,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- Create partitions for the next 12 months from project start.
-- New partitions are created by a scheduled maintenance task.
CREATE TABLE audit.audit_log_2026_04 PARTITION OF audit.audit_log
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE TABLE audit.audit_log_2026_05 PARTITION OF audit.audit_log
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE TABLE audit.audit_log_2026_06 PARTITION OF audit.audit_log
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE audit.audit_log_2026_07 PARTITION OF audit.audit_log
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE TABLE audit.audit_log_2026_08 PARTITION OF audit.audit_log
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE TABLE audit.audit_log_2026_09 PARTITION OF audit.audit_log
    FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

CREATE TABLE audit.audit_log_2026_10 PARTITION OF audit.audit_log
    FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

CREATE TABLE audit.audit_log_2026_11 PARTITION OF audit.audit_log
    FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');

CREATE TABLE audit.audit_log_2026_12 PARTITION OF audit.audit_log
    FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

CREATE TABLE audit.audit_log_2027_01 PARTITION OF audit.audit_log
    FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');

CREATE TABLE audit.audit_log_2027_02 PARTITION OF audit.audit_log
    FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');

CREATE TABLE audit.audit_log_2027_03 PARTITION OF audit.audit_log
    FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');

-- Indexes on the base table propagate to all partitions.
CREATE INDEX audit_log_org_id_idx ON audit.audit_log (org_id, occurred_at);
CREATE INDEX audit_log_resource_idx ON audit.audit_log (resource_type, resource_id);

-- ---------------------------------------------------------------------------
-- Permissions: INSERT only — never UPDATE or DELETE.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA audit TO meshos_app;
GRANT SELECT, INSERT ON audit.audit_log TO meshos_app;
-- Explicitly revoke — belt-and-suspenders.
REVOKE UPDATE, DELETE ON audit.audit_log FROM meshos_app;
REVOKE UPDATE, DELETE ON ALL TABLES IN SCHEMA audit FROM PUBLIC;

-- RLS on audit log — principals can only read their own org's records.
ALTER TABLE audit.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_org_isolation ON audit.audit_log
    FOR SELECT TO meshos_app
    USING (org_id = current_setting('meshos.current_org_id', true)::UUID);

-- INSERT policy: always allowed for the app role (auditing is non-restrictable).
CREATE POLICY audit_log_insert ON audit.audit_log
    FOR INSERT TO meshos_app WITH CHECK (true);
