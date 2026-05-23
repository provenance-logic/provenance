-- Migration V33: Inbound-outbound bridge — F2.8a (closes B-070)
--
-- Adds the FK + path columns that let a port_declaration reference a
-- registered source object. This is the schema half of PRD F2.8a
-- (Output Port Source Object Binding) as landed in #175. Closes the
-- structural half of B-070; the service-layer wiring and producer UI
-- are separate pieces of the same Phase 5.8 workstream.
--
-- Both columns are NULLABLE — source binding is optional. Ports for
-- sources not behind a discovery-capable connector (REST APIs not
-- managed by Provenance, hand-authored static files, etc.) keep both
-- columns NULL and continue to render hand-authored schema and
-- connection details. When a port IS bound:
--
--   - source_registration_id references the connector-side
--     registration row (durable identity); deletion is RESTRICTed
--     because removing a source while a port depends on it would
--     break the consumer-facing port silently.
--   - source_object_path names the specific object inside the source
--     (e.g., 'prod.customer.events' for a 3-part Unity Catalog name,
--     'topic.user_signups' for a Kafka topic, 's3://bucket/prefix/'
--     for an S3 prefix). The string shape is deferred to the
--     connector — they already know how to interpret a path string,
--     and validating it here would couple this migration to every
--     connector type's naming convention.
--
-- The single-FK shape (one port → one source) is the OSR commitment
-- per anchor-decisions doc decision 4. A per-port join table for
-- multi-source ports is deferred post-OSR; producers needing that
-- shape today should model it as a view in the source system and
-- bind the port to the view.

BEGIN;

ALTER TABLE products.port_declarations
    ADD COLUMN source_registration_id UUID NULL
        REFERENCES connectors.source_registrations(id) ON DELETE RESTRICT,
    ADD COLUMN source_object_path     TEXT NULL;

-- Index on the FK so the join from ProductEnrichmentService (port →
-- source → latest schema_snapshot) doesn't sequentially scan
-- port_declarations.
CREATE INDEX port_declarations_source_registration_id_idx
    ON products.port_declarations (source_registration_id)
    WHERE source_registration_id IS NOT NULL;

COMMIT;
