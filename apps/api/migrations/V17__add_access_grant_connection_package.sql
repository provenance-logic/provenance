-- Migration V17: Connection package on access grants (Domain 10 Workstream B — F10.8)
--
-- Adds a JSONB column holding the ready-to-use connection artifact generated
-- at grant time (F10.8). Nullable because:
--   * existing grants predate the feature
--   * grants for products with no output port interfaceType set cannot have
--     a package yet
-- Package versioning (F10.10 refresh) is carried inside the JSON payload
-- (packageVersion, generatedAt), not in a separate column.

ALTER TABLE access.access_grants
    ADD COLUMN connection_package JSONB;
