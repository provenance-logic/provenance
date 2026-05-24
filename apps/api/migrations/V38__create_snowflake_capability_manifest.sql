-- Migration V38: Snowflake connector capability manifest (v1.0.0)
--
-- Declares what the Snowflake connector can do at the Layer 3 milestone:
-- probe (key-pair JWT SELECT 1), schema inference (INFORMATION_SCHEMA.COLUMNS),
-- and discovery crawl (SHOW DATABASES / SHOW TABLES / SHOW VIEWS walk).
--
-- Lineage emission and discovery are false — they ship in a later manifest
-- version (snowflake 1.1.0) once ACCESS_HISTORY / OBJECT_DEPENDENCIES support
-- lands in Layer 4. Per CLAUDE.md: "Connector capability manifests are
-- immutable per version. Never mutate a capability manifest in place — create
-- a new connector version." This row is therefore insert-only.
--
-- Once this row exists with supports_discovery_crawl=true, the
-- auto-crawl-on-registration path in ConnectorsService (~line 178, gated on
-- manifest?.supportsDiscoveryCrawl) fires for Snowflake automatically.

INSERT INTO connectors.capability_manifests (
    connector_type, version,
    supports_probe, supports_schema_inference, supports_discovery_crawl,
    supports_lineage_emission, supports_lineage_discovery,
    discovery_granularity, re_crawl_interval_hours_default,
    capabilities_doc
) VALUES (
    'snowflake', '1.0.0',
    true, true, true,
    false, false,
    'asset_level', 24,
    '{
      "credentialFormat": {
        "type": "key_pair_jwt",
        "secretShape": "{\"privateKeyPem\":\"-----BEGIN PRIVATE KEY-----\\n...\",\"user\":\"PROVENANCE_SVC\",\"account\":\"xy12345\"}"
      },
      "probeApiPath": "/api/v2/statements",
      "discoveryApi": "SHOW DATABASES; SHOW TABLES IN DATABASE <db>; SHOW VIEWS IN DATABASE <db>",
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
        "Lineage discovery (ACCOUNT_USAGE.OBJECT_DEPENDENCIES + ACCESS_HISTORY) arrives in a later manifest version (snowflake 1.1.0) once Layer 4 ships",
        "Only key-pair JWT auth is supported in this version; OAuth and PAT are follow-ups"
      ]
    }'::jsonb
);
