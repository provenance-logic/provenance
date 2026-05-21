-- Migration V31: Connector capability manifests
-- Each row declares what a connector type/version can do — probe? schema
-- inference? discovery crawl? lineage emission? lineage discovery? — plus
-- the recommended re-crawl interval and a JSONB "capabilities_doc" for the
-- richer per-category granularity (CLAUDE.md's "metadata categories":
-- structural, descriptive, operational, quality, governance).
--
-- Per CLAUDE.md: "Connector capability manifests are immutable per version.
-- Never mutate a capability manifest in place — create a new connector
-- version." This is enforced at the application layer (no UPDATE/DELETE
-- service methods exposed); the DB only carries the (type, version) unique
-- constraint. See B-063 Layer 3b.

CREATE TABLE connectors.capability_manifests (
    id                                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    connector_type                    VARCHAR(64)  NOT NULL,
    version                           VARCHAR(32)  NOT NULL,
    supports_probe                    BOOLEAN      NOT NULL DEFAULT false,
    supports_schema_inference         BOOLEAN      NOT NULL DEFAULT false,
    supports_discovery_crawl          BOOLEAN      NOT NULL DEFAULT false,
    supports_lineage_emission         BOOLEAN      NOT NULL DEFAULT false,
    supports_lineage_discovery        BOOLEAN      NOT NULL DEFAULT false,
    discovery_granularity             VARCHAR(32)
                                          CHECK (discovery_granularity IS NULL OR
                                                 discovery_granularity IN ('asset_level', 'column_level')),
    re_crawl_interval_hours_default   INTEGER,
    capabilities_doc                  JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at                        TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT capability_manifests_type_version_unique UNIQUE (connector_type, version)
);

CREATE INDEX capability_manifests_type_idx
    ON connectors.capability_manifests (connector_type);

GRANT SELECT, INSERT ON connectors.capability_manifests TO provenance_app;
-- Belt-and-suspenders: deny UPDATE/DELETE at the role level. Application
-- code never exposes mutation; this is the structural guarantee.
REVOKE UPDATE, DELETE ON connectors.capability_manifests FROM provenance_app;

-- ---------------------------------------------------------------------------
-- Seed: Databricks 1.0.0 manifest
-- ---------------------------------------------------------------------------
-- Reflects what the Databricks connector ACTUALLY does today after Layers
-- 1+2+3a have landed: probe (SCIM /Me), schema inference (Unity Catalog
-- tables/{full_name}), discovery crawl (Unity Catalog catalogs/schemas/tables
-- walk with column-level granularity). Lineage emission/discovery flips to
-- true when Layer 4 ships.

INSERT INTO connectors.capability_manifests (
    connector_type, version,
    supports_probe, supports_schema_inference, supports_discovery_crawl,
    supports_lineage_emission, supports_lineage_discovery,
    discovery_granularity, re_crawl_interval_hours_default,
    capabilities_doc
) VALUES (
    'databricks', '1.0.0',
    true, true, true,
    false, false,
    'column_level', 24,
    '{
      "credentialFormat": {
        "type": "personal_access_token_or_oauth_m2m",
        "secretShape": "{\"token\":\"dapi...\"}"
      },
      "discoveryApiBase": "/api/2.1/unity-catalog",
      "probeApiPath": "/api/2.0/preview/scim/v2/Me",
      "metadataCategoryCoverage": {
        "structural": "high",
        "descriptive": "medium",
        "operational": "low",
        "quality": "none",
        "governance": "low"
      },
      "knownLimitations": [
        "Hive-metastore-only workspaces fall back to SQL warehouse path — not yet implemented (B-063 deferred)",
        "Row estimates not exposed by Unity Catalog without a SQL warehouse query"
      ]
    }'::jsonb
);
