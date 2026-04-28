-- Cleanup script for seed-data test artifacts that were originally
-- published into the Acme Corp seed during Phase 4b/Domain 9 verification
-- and have since been decommissioned but never removed. They linger in
-- queries and surfaces other than the marketplace listing (lifecycle
-- history, lineage, search history) where they look unprofessional next
-- to real seed products.
--
-- Targets a fixed name list so the script is portable across
-- environments: anything not in the list, or anything that has been
-- (re)published under a matching name, is left alone.
--
-- Idempotent — re-running is a no-op once the targets are gone.
--
-- Usage (against the dev EC2 stack):
--   docker exec -i provenance-ec2-postgres \
--     psql -U provenance -d provenance \
--     < infrastructure/scripts/cleanup-test-artifacts.sql

\set ON_ERROR_STOP on

BEGIN;

-- Resolve target product ids by name + safety guard (never published).
CREATE TEMP TABLE _targets ON COMMIT DROP AS
SELECT id, name, status, org_id
  FROM products.data_products
 WHERE name IN (
         'Phase 4b Verification Product',
         'A5 Index Freshness Test',
         'Semantic Search Test Product',
         'Port Test Data Product'
       )
   AND status <> 'published';

\echo 'Targets resolved:'
SELECT id, name, status FROM _targets ORDER BY name;

-- Restricted-FK cleanup, in dependency order. CASCADE FKs (port
-- declarations, compliance_states, exceptions, grace_periods) take
-- care of themselves on the final product delete.

-- consent.connection_references → access.access_grants (RESTRICT)
DELETE FROM consent.connection_references
 WHERE product_id IN (SELECT id FROM _targets);

DELETE FROM access.access_grants
 WHERE product_id IN (SELECT id FROM _targets);

DELETE FROM access.access_requests
 WHERE product_id IN (SELECT id FROM _targets);

DELETE FROM observability.slo_declarations
 WHERE product_id IN (SELECT id FROM _targets);

DELETE FROM observability.trust_score_history
 WHERE product_id IN (SELECT id FROM _targets);

DELETE FROM products.lifecycle_events
 WHERE product_id IN (SELECT id FROM _targets);

DELETE FROM products.product_versions
 WHERE product_id IN (SELECT id FROM _targets);

-- Final delete — cascades to port_declarations, compliance_states,
-- exceptions, grace_periods.
DELETE FROM products.data_products
 WHERE id IN (SELECT id FROM _targets);

\echo 'Remaining matches (expected: 0 rows):'
SELECT id, name, status
  FROM products.data_products
 WHERE name IN (
         'Phase 4b Verification Product',
         'A5 Index Freshness Test',
         'Semantic Search Test Product',
         'Port Test Data Product'
       );

COMMIT;
