-- Migration V34: Producer Situation-A-eligibility declaration on ports
--
-- First-layer implementation of F10.15 (Situation Detection per Port) for
-- Phase 5.9. Per anchor-decisions doc decision 6c, situation detection is
-- layered: producer declaration (this migration) is the primary signal;
-- probe-based verification (separate follow-up) is the fallback; directory
-- integration (post-OSR per OS10.4) is the future hardening.
--
-- `situation_a_eligibility` declares whether a consumer with any valid
-- source-system credential (no per-product grant required) can reach this
-- port. Examples where the producer would set this true:
--   - PG: table granted to PUBLIC or to a broad role every source-system
--     user already holds.
--   - Snowflake: data exposed via a share open to all members of the
--     consuming organisation.
--   - S3: object accessible to every authenticated AWS principal in the
--     consuming account.
--
-- Default is `false` (Situation B — per-product GRANT required), matching
-- the conservative consumer-grade-OSR posture: a producer must explicitly
-- opt a port into Situation-A eligibility. Mis-declaration risk is
-- mitigated post-OSR by the F10.15 layer-2 probe at the connect flow
-- entry point.
--
-- The flag is per-port (not per-product) because a product may expose
-- multiple ports with different access shapes (e.g. an Output port open
-- to all source-system users vs a Control port restricted to admins).

BEGIN;

ALTER TABLE products.port_declarations
    ADD COLUMN situation_a_eligibility BOOLEAN NOT NULL DEFAULT false;

-- Lightweight partial index — situation-A ports are the minority in
-- typical mesh deployments; consumer-flow queries scan this column
-- frequently when filtering "which of my ports are open-access?"
CREATE INDEX port_declarations_situation_a_eligible_idx
    ON products.port_declarations (org_id, product_id)
    WHERE situation_a_eligibility = true;

COMMIT;
