-- Migration V27: Idempotency key on lineage emission log
-- Adds an optional client-supplied key that lets callers (the seed runner,
-- pipeline SDKs) re-emit the same logical lineage event without producing
-- duplicate emission_log rows or duplicate Neo4j edges. When a key is
-- present, LineageService.emitEvent looks up an existing row first and
-- returns it instead of inserting a new one.

ALTER TABLE lineage.emission_log
    ADD COLUMN idempotency_key VARCHAR(255);

CREATE UNIQUE INDEX emission_log_idempotency_key_uniq
    ON lineage.emission_log (org_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
