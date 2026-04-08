-- Migration V11: Trust score history
-- Stores computed trust scores as a time series. The current score
-- is always the most recent row for a given product_id.

CREATE TABLE IF NOT EXISTS observability.trust_score_history (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID         NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    product_id   UUID         NOT NULL REFERENCES products.data_products(id) ON DELETE RESTRICT,
    score        NUMERIC(6,4) NOT NULL,
    band         TEXT         NOT NULL,
    components   JSONB        NOT NULL,
    computed_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX trust_score_history_product_idx ON observability.trust_score_history (product_id, computed_at DESC);
CREATE INDEX trust_score_history_org_idx ON observability.trust_score_history (org_id, computed_at DESC);
