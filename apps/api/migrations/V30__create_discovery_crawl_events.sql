-- Migration V30: Discovery crawl events
-- One row per discovery crawl invocation (manual or scheduled). Records
-- what catalogs/schemas/tables were walked, how many sources were created
-- vs. skipped (idempotent re-crawls), how many schema snapshots succeeded,
-- and any failure detail. The operator's view into "what did the last
-- crawl do?" lives here. Scheduled re-crawl orchestration (Temporal) is
-- a follow-up; today the events are populated by an operator-triggered
-- POST /connectors/:id/crawl. See B-063 Layer 3a.

CREATE TABLE connectors.discovery_crawl_events (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID         NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    connector_id        UUID         NOT NULL REFERENCES connectors.connectors(id) ON DELETE CASCADE,
    triggered_by        UUID         REFERENCES identity.principals(id),
    started_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ,
    status              VARCHAR(32)  NOT NULL
                            CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
    catalogs_walked     INTEGER      NOT NULL DEFAULT 0,
    schemas_walked      INTEGER      NOT NULL DEFAULT 0,
    tables_found        INTEGER      NOT NULL DEFAULT 0,
    sources_created     INTEGER      NOT NULL DEFAULT 0,
    sources_skipped     INTEGER      NOT NULL DEFAULT 0,
    snapshots_captured  INTEGER      NOT NULL DEFAULT 0,
    snapshots_failed    INTEGER      NOT NULL DEFAULT 0,
    error_message       TEXT,
    metadata            JSONB        NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX discovery_crawl_events_connector_idx
    ON connectors.discovery_crawl_events (connector_id, started_at DESC);
CREATE INDEX discovery_crawl_events_org_idx
    ON connectors.discovery_crawl_events (org_id, started_at DESC);

ALTER TABLE connectors.discovery_crawl_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON connectors.discovery_crawl_events TO provenance_app;

CREATE POLICY discovery_crawl_events_org_isolation ON connectors.discovery_crawl_events
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);
