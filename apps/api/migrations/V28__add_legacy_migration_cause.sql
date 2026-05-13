-- V28: Add 'legacy_migration' to the consent.connection_references.caused_by
-- CHECK constraint.
--
-- F12.25 requires a one-time migration that auto-provisions legacy-compatibility
-- connection references for every existing active access grant at Domain 12
-- enforcement activation. Each provisioned row needs a cause marker that
-- distinguishes it from principal-initiated and other automated transitions.
-- The seven existing cause values do not fit ("legacy migration" is neither a
-- principal action nor any of the cascade types), so we extend the enum here.
--
-- The original constraint was declared inline in V18 with an auto-generated
-- name. We look it up via pg_constraint, drop it, and re-create with the
-- explicit name `connection_references_caused_by_check` plus the new value.
-- The DO block makes the migration idempotent against environments where the
-- constraint may already have been renamed by a prior manual fix.

DO $$
DECLARE
    v_constraint_name text;
BEGIN
    SELECT conname INTO v_constraint_name
    FROM pg_constraint
    WHERE conrelid = 'consent.connection_references'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%caused_by%';

    IF v_constraint_name IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE consent.connection_references DROP CONSTRAINT %I',
            v_constraint_name
        );
    END IF;
END
$$;

ALTER TABLE consent.connection_references
    ADD CONSTRAINT connection_references_caused_by_check
    CHECK (caused_by IS NULL OR caused_by IN (
        'principal_action',
        'governance_action',
        'automatic_expiration',
        'major_version_suspension',
        'grant_revocation_cascade',
        'product_lifecycle_cascade',
        'principal_lifecycle_cascade',
        'legacy_migration'
    ));
