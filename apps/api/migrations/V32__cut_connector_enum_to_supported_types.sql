-- Migration V32: Cut the connector_type enum to the types that actually work
--
-- Closes step 1 of B-063 (anchor decision 5, Option 3+4 — see
-- documents/architecture/prd-overhaul-anchor-decisions-2026-05-23.md). The
-- platform shipped V6 with a 13-value CHECK constraint advertising types
-- the framework could not actually probe or introspect; only postgresql,
-- s3, and databricks had real implementations. This migration retires the
-- 9 unimplemented types and tightens the CHECK constraint to the 3 that
-- ship end-to-end at the consumer-grade bar per PRD F3.2.
--
-- The retired types (mysql, snowflake, bigquery, redshift, gcs, azure_blob,
-- kafka, redpanda, rest_api, custom) are removed from the CHECK constraint.
-- Snowflake is the next scheduled addition under the F3.2a tranche cadence
-- and will return via a future migration once it meets the F3.2 bar.
--
-- Data cleanup: any existing rows in connectors.connectors carrying a
-- retired type are deleted along with their dependents. Pre-launch this is
-- safe — the retired types' "probes" returned synthetic healthy without
-- actually doing anything, so any registered connectors of those types had
-- no real operational meaning. Dependent FKs: discovery_crawl_events and
-- connector_health_events CASCADE; source_registrations and schema_snapshots
-- RESTRICT, so they're deleted explicitly first.
--
-- The deletes run as the migration role (which bypasses the app-role REVOKE
-- on connector_health_events and schema_snapshots — those tables are
-- append-only at the application layer, not the database layer).

BEGIN;

-- ---------------------------------------------------------------------------
-- Data cleanup — remove any rows for retired connector types.
-- Ordering matters: schema_snapshots → source_registrations → connectors
-- (the latter CASCADES to connector_health_events + discovery_crawl_events).
-- ---------------------------------------------------------------------------

DELETE FROM connectors.schema_snapshots
WHERE source_registration_id IN (
    SELECT sr.id
    FROM connectors.source_registrations sr
    JOIN connectors.connectors c ON sr.connector_id = c.id
    WHERE c.connector_type NOT IN ('postgresql', 's3', 'databricks')
);

DELETE FROM connectors.source_registrations
WHERE connector_id IN (
    SELECT id FROM connectors.connectors
    WHERE connector_type NOT IN ('postgresql', 's3', 'databricks')
);

DELETE FROM connectors.connectors
WHERE connector_type NOT IN ('postgresql', 's3', 'databricks');

-- ---------------------------------------------------------------------------
-- Drop the existing CHECK constraint and add the tightened one.
-- The original constraint was declared inline in V6 with Postgres's auto-
-- generated name; the DO block locates it by inspecting its definition,
-- since auto-generated names vary by Postgres version.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    cname text;
BEGIN
    FOR cname IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'connectors.connectors'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%connector_type%'
    LOOP
        EXECUTE format('ALTER TABLE connectors.connectors DROP CONSTRAINT %I', cname);
    END LOOP;
END $$;

ALTER TABLE connectors.connectors
    ADD CONSTRAINT connectors_connector_type_check
    CHECK (connector_type IN ('postgresql', 's3', 'databricks'));

COMMIT;
