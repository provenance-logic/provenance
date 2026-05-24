-- Migration V37: Add 'snowflake' to the connector_type CHECK constraint
--
-- Snowflake is the next first-class connector under the F3.2a tranche
-- cadence (B-063). Layers 1 (probe) and 2 (schema inference) ship with
-- this migration. Layers 3 (discovery crawl) and 4 (lineage) follow.
--
-- The CHECK constraint introduced by V32 allows only ('postgresql','s3',
-- 'databricks'). We drop and recreate it to add 'snowflake'. The DO
-- block that locates the constraint by definition — rather than by name
-- — is reused verbatim from V32, because the constraint name we wrote
-- in V32 is now known (connectors_connector_type_check), but being
-- defensive costs nothing and survives future renames.

BEGIN;

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
    CHECK (connector_type IN ('postgresql', 's3', 'databricks', 'snowflake'));

COMMIT;
