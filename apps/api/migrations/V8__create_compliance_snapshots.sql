-- V8: Compliance snapshots for governance dashboard trend chart.
-- Stores a daily point-in-time snapshot of compliance state distribution.
-- Populated by the governance re-evaluation workflow or a daily cron.

CREATE TABLE governance.compliance_snapshots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL,
    snapshot_date   DATE NOT NULL,
    compliant       INTEGER NOT NULL DEFAULT 0,
    drift_detected  INTEGER NOT NULL DEFAULT 0,
    grace_period    INTEGER NOT NULL DEFAULT 0,
    non_compliant   INTEGER NOT NULL DEFAULT 0,
    total           INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT compliance_snapshots_org_date_unique UNIQUE (org_id, snapshot_date)
);

CREATE INDEX compliance_snapshots_org_date_idx
    ON governance.compliance_snapshots (org_id, snapshot_date DESC);
