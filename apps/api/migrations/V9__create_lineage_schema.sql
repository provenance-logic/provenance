-- Migration V9: Lineage schema
-- Stores lineage emission events and tracks Neo4j sync status.
-- Each row represents a directional edge (source_node → target_node) in the
-- lineage graph. The API writes to this table on POST /lineage/events and a
-- background sync marks neo4j_written = true after persisting to Neo4j.

CREATE SCHEMA IF NOT EXISTS lineage;

-- ---------------------------------------------------------------------------
-- Emission log
-- One row per lineage emission event. Stores the source and target node
-- descriptors plus sync state for the Neo4j graph projection.
-- ---------------------------------------------------------------------------
CREATE TABLE lineage.emission_log (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            UUID         NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    source_node       JSONB        NOT NULL,
    target_node       JSONB        NOT NULL,
    edge_type         VARCHAR(64)  NOT NULL DEFAULT 'DERIVES_FROM',
    confidence        NUMERIC(3,2) NOT NULL DEFAULT 1.00
                          CHECK (confidence >= 0 AND confidence <= 1),
    emitted_by        VARCHAR(255),
    emitted_at        TIMESTAMPTZ  NOT NULL,
    neo4j_written     BOOLEAN      NOT NULL DEFAULT FALSE,
    neo4j_written_at  TIMESTAMPTZ,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX emission_log_org_idx         ON lineage.emission_log (org_id);
CREATE INDEX emission_log_emitted_at_idx  ON lineage.emission_log (emitted_at DESC);
CREATE INDEX emission_log_pending_sync    ON lineage.emission_log (created_at)
    WHERE neo4j_written = FALSE;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
ALTER TABLE lineage.emission_log ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA lineage TO provenance_app;
GRANT SELECT, INSERT, UPDATE ON lineage.emission_log TO provenance_app;

CREATE POLICY emission_log_org_isolation ON lineage.emission_log
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);
