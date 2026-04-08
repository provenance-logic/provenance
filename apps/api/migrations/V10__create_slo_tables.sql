-- Migration V10: SLO declarations and evaluations
-- Part of the observability schema. Domain teams declare SLOs on their
-- data products; external systems post evaluation results.

CREATE SCHEMA IF NOT EXISTS observability;

-- ---------------------------------------------------------------------------
-- SLO declarations
-- ---------------------------------------------------------------------------
CREATE TABLE observability.slo_declarations (
    id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                  UUID         NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    product_id              UUID         NOT NULL REFERENCES products.data_products(id) ON DELETE RESTRICT,
    name                    TEXT         NOT NULL,
    description             TEXT,
    slo_type                TEXT         NOT NULL CHECK (slo_type IN
                                ('freshness','null_rate','latency','completeness','custom')),
    metric_name             TEXT         NOT NULL,
    threshold_operator      TEXT         NOT NULL CHECK (threshold_operator IN
                                ('lt','lte','gt','gte','eq')),
    threshold_value         NUMERIC      NOT NULL,
    threshold_unit          TEXT,
    evaluation_window_hours INTEGER      NOT NULL DEFAULT 24,
    external_system         TEXT,
    active                  BOOLEAN      NOT NULL DEFAULT true,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX slo_declarations_org_product_idx ON observability.slo_declarations (org_id, product_id);
CREATE INDEX slo_declarations_product_active_idx ON observability.slo_declarations (product_id, active);

-- ---------------------------------------------------------------------------
-- SLO evaluations
-- ---------------------------------------------------------------------------
CREATE TABLE observability.slo_evaluations (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    slo_id          UUID         NOT NULL REFERENCES observability.slo_declarations(id) ON DELETE CASCADE,
    org_id          UUID         NOT NULL,
    measured_value  NUMERIC      NOT NULL,
    passed          BOOLEAN      NOT NULL,
    evaluated_at    TIMESTAMPTZ  NOT NULL,
    evaluated_by    TEXT         NOT NULL,
    details         JSONB,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX slo_evaluations_slo_at_idx ON observability.slo_evaluations (slo_id, evaluated_at DESC);
CREATE INDEX slo_evaluations_slo_passed_at_idx ON observability.slo_evaluations (slo_id, passed, evaluated_at DESC);
CREATE INDEX slo_evaluations_org_at_idx ON observability.slo_evaluations (org_id, evaluated_at DESC);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
CREATE TRIGGER slo_declarations_updated_at
    BEFORE UPDATE ON observability.slo_declarations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
ALTER TABLE observability.slo_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE observability.slo_evaluations  ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA observability TO provenance_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON observability.slo_declarations TO provenance_app;
GRANT SELECT, INSERT ON observability.slo_evaluations TO provenance_app;

CREATE POLICY slo_declarations_org_isolation ON observability.slo_declarations
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

CREATE POLICY slo_evaluations_org_isolation ON observability.slo_evaluations
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);
