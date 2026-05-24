-- Migration V35: 7-day grant expiry warning tier — F10.19 / Phase 5.13
--
-- Domain 11's AccessNotificationsTriggerWorker already fires a 14-day
-- expiry warning (tracked via access_grants.expiry_warning_sent_at). F10.19
-- adds a second, more urgent warning at 7 days before expiry. This
-- migration adds the sibling tracking column so each tier fires exactly
-- once per grant.
--
-- Both columns are NULL until the corresponding warning fires; the worker's
-- query joins on `IS NULL` to skip already-warned grants. The 14d column
-- name `expiry_warning_sent_at` is preserved (not renamed) to avoid an
-- entity-rename ripple; this column is `expiry_warning_7d_sent_at`.

BEGIN;

ALTER TABLE access.access_grants
    ADD COLUMN expiry_warning_7d_sent_at TIMESTAMPTZ NULL;

COMMIT;
