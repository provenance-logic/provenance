-- Migration V20: add updated_at to access.access_grants (B-009)
--
-- Originally drafted as V18 in a parallel session; renumbered to V20 because
-- V18 and V19 were claimed by the consent schema migrations from the Domain 12
-- workstream (#22, #28).
--
-- V7__create_access_schema.sql:131-133 created the BEFORE UPDATE trigger
-- access_grants_updated_at -> update_updated_at(), but the table definition
-- (V7:16-29) was missing the updated_at column. Every UPDATE failed with
-- 'record "new" has no field "updated_at"', breaking AccessService.revokeGrant
-- and any future grant mutation. The sibling access_requests table (V7:45-60)
-- includes the column, so its trigger works.

ALTER TABLE access.access_grants
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill: prefer revoked_at when the grant has already been revoked,
-- otherwise fall back to granted_at (the only other non-null timestamp).
UPDATE access.access_grants
SET    updated_at = COALESCE(revoked_at, granted_at);
