-- Migration V36: Catalog name primitive — F10.14 / Phase 5.11
--
-- The producer can declare a catalog name on each output port so the
-- consumer sees a stable, friendly identifier (e.g. `customer_360`)
-- instead of the underlying physical path
-- (e.g. `prod_warehouse_v2.sales_mart.customer_360_legacy_2024`).
--
-- Per the F10.14 source-side mechanism: for PG / Snowflake / Databricks,
-- the producer creates a VIEW in the source system named to match the
-- catalog name; snippets reference the view. For S3 (no view primitive),
-- the catalog name is UI-only and the snippet falls back to the bucket
-- path (the abstraction leak is acknowledged).
--
-- This column is NULL by default. When NULL the snippet generator falls
-- back to the F2.8a `source_object_path`, then to a generic
-- `<schema>.<table>` template — the catalog-name abstraction is opt-in
-- per port. The platform never executes the CREATE VIEW DDL itself
-- (Constraint 3 / ADR-011); the producer copies it into their source
-- system. A helper endpoint at
-- `GET /products/:id/ports/:portId/source-view-ddl` generates the DDL.
--
-- No DB-level constraint on identifier shape — different source systems
-- have different valid-identifier rules. The producer UI applies
-- client-side validation (alphanumeric + underscore, must start with a
-- letter); the source system will reject invalid identifiers when the
-- DDL is executed.

BEGIN;

ALTER TABLE products.port_declarations
    ADD COLUMN catalog_name TEXT NULL;

COMMIT;
