-- Migration V39: Snowflake capability manifest v1.1.0 — Layer 4 lineage discovery
--
-- Adds OBJECT_DEPENDENCIES-based static lineage discovery for Snowflake.
-- Per CLAUDE.md: manifests are immutable per version — V38 row (v1.0.0) is
-- unchanged; this migration inserts a new v1.1.0 row alongside it.
--
-- "Latest version" is resolved by CapabilityManifestService.getLatestForType
-- using `order: { version: 'DESC' }` (lexicographic). '1.1.0' > '1.0.0'
-- lexicographically, so this row becomes the effective manifest for Snowflake
-- immediately after the migration runs.
--
-- What changed from 1.0.0:
--   supports_lineage_discovery: false → true
--   capabilities_doc.lineageDiscovery: documents OBJECT_DEPENDENCIES source
--   capabilities_doc.knownLimitations: removes the "deferred" note and adds
--     the ACCESS_HISTORY deferral note.
--
-- ACCESS_HISTORY (query-derived lineage) is deliberately deferred to a later
-- manifest version (snowflake 1.2.0 / "Layer 4b") because:
--   - It requires the Snowflake Enterprise tier (not available on trial/standard).
--   - Query history has an inherent ~3h processing lag before rows appear.
--   - Writing a reliable test requires live read→write operations against a
--     real Enterprise account — that test data doesn't exist yet.
--   See TODO in walkSnowflakeLineage in connector-probe.service.ts.

INSERT INTO connectors.capability_manifests (
    connector_type, version,
    supports_probe, supports_schema_inference, supports_discovery_crawl,
    supports_lineage_emission, supports_lineage_discovery,
    discovery_granularity, re_crawl_interval_hours_default,
    capabilities_doc
) VALUES (
    'snowflake', '1.1.0',
    true, true, true,
    false, true,
    'asset_level', 24,
    '{
      "credentialFormat": {
        "type": "key_pair_jwt",
        "secretShape": "{\"privateKeyPem\":\"-----BEGIN PRIVATE KEY-----\\n...\",\"user\":\"PROVENANCE_SVC\",\"account\":\"xy12345\"}"
      },
      "probeApiPath": "/api/v2/statements",
      "discoveryApi": "SHOW DATABASES; SHOW TABLES IN DATABASE <db>; SHOW VIEWS IN DATABASE <db>",
      "lineageDiscovery": {
        "source": "SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES",
        "granularity": "asset_level",
        "edgeType": "DERIVES_FROM",
        "notes": "Static view→table lineage from OBJECT_DEPENDENCIES. Requires ACCOUNTADMIN role or IMPORTED PRIVILEGES on SNOWFLAKE database. One SELECT per crawl — not N-per-table.",
        "deferred": "ACCESS_HISTORY query-derived lineage is deferred to snowflake v1.2.0 — Enterprise-tier only, ~3h processing lag, requires live read→write test data."
      },
      "metadataCategoryCoverage": {
        "structural": "high",
        "descriptive": "medium",
        "operational": "low",
        "quality": "none",
        "governance": "low"
      },
      "knownLimitations": [
        "System databases SNOWFLAKE and SNOWFLAKE_SAMPLE_DATA are always skipped",
        "INFORMATION_SCHEMA schema is always skipped within each database",
        "Accounts with >10k tables or views in a single database need cursor pagination — deferred (LIMIT ... FROM cursor pattern not yet implemented)",
        "ACCESS_HISTORY query-derived lineage (Enterprise-gated, ~3h lag) is deferred to a later manifest version (snowflake 1.2.0 / Layer 4b)",
        "Only key-pair JWT auth is supported in this version; OAuth and PAT are follow-ups",
        "OBJECT_DEPENDENCIES lineage edges to/from system schemas (INFORMATION_SCHEMA, SNOWFLAKE, SNOWFLAKE_SAMPLE_DATA, USER$*) are filtered at emit time"
      ]
    }'::jsonb
);
