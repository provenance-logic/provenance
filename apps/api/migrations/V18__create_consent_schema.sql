-- Migration V18: Consent schema (Domain 12 — F12.1 through F12.6)
--
-- Introduces the connection reference primitive: a first-class, owned, revocable
-- authorization record that pairs an agent's access to a product with an explicit
-- human-consented use-case declaration. Composes with access grants (see ADR-005):
-- both an active access grant AND an active connection reference are required for
-- any agent action against any product.
--
-- Scope of this migration:
--   F12.1 — connection reference as owned entity (structural foundation)
--   F12.2 — lifecycle states (pending, active, suspended, expired, revoked)
--   F12.3 — ownership (owning_principal_id required, immutable; enforced at app layer)
--   F12.4 — explicit expiration (expires_at NOT NULL)
--   F12.5 — use-case declaration required (NOT NULL on use-case fields)
--   F12.6 — use-case declaration structure (category, elaboration, scope, duration,
--           optional data category constraints)
--
-- Deferred to later migrations / F-IDs:
--   F12.10 request routing and notification (Domain 11)
--   F12.11 immutable consent record projection (will add audit.consent_records table)
--   F12.13 connection package emission on activation (Domain 10, F10.8)
--   F12.16+ runtime scope enforcement at the Agent Query Layer (ADR-006)
--   Outbox publisher worker and Redpanda topic wiring (ADR-007)
--
-- The outbox table is created here because every state transition is required by
-- ADR-007 to insert into it in the same transaction as the state change. Shipping
-- the destination table with the entity keeps writers consistent from day one.

CREATE SCHEMA IF NOT EXISTS consent;

-- ---------------------------------------------------------------------------
-- Connection references
--
-- Mutable across non-terminal states. Terminal states (expired, revoked) are
-- immutable by design — enforced at the application layer via the state machine
-- service; the terminal-state audit record in audit.audit_log is the durable
-- proof of terminality.
--
-- access_grant_id links the reference to the grant that authorizes the
-- underlying access. Per ADR-005, the cascade is one-directional: revoking a
-- grant revokes all its references (F12.21); revoking a reference does not
-- revoke the grant.
--
-- approved_* fields are set at activation (state → active). They may narrow
-- the originally requested scope per F12.7; modified_by_approver records that
-- the approver changed scope vs. the original request. Both sides are
-- preserved here; the fuller audit trail lives in audit.audit_log.
-- ---------------------------------------------------------------------------
CREATE TABLE consent.connection_references (
    id                         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                     UUID         NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    agent_id                   UUID         NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    product_id                 UUID         NOT NULL REFERENCES products.data_products(id) ON DELETE RESTRICT,
    -- Null until activation; set to the product version in effect at approval time (F12.15).
    product_version_id         UUID         REFERENCES products.product_versions(id) ON DELETE RESTRICT,
    access_grant_id            UUID         NOT NULL REFERENCES access.access_grants(id) ON DELETE RESTRICT,
    owning_principal_id        UUID         NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,

    -- Lifecycle state (F12.2). CHECK constraint used instead of a PostgreSQL enum
    -- type for migration flexibility; adding states via CHECK rewrite is cheaper
    -- than ALTER TYPE in production.
    state                      VARCHAR(32)  NOT NULL DEFAULT 'pending'
                                    CHECK (state IN ('pending', 'active', 'suspended', 'expired', 'revoked')),
    caused_by                  VARCHAR(64)
                                    CHECK (caused_by IS NULL OR caused_by IN (
                                        'principal_action',
                                        'governance_action',
                                        'automatic_expiration',
                                        'major_version_suspension',
                                        'grant_revocation_cascade',
                                        'product_lifecycle_cascade',
                                        'principal_lifecycle_cascade'
                                    )),

    -- Lifecycle timestamps. expires_at is NOT NULL per F12.4 (no indefinite references).
    requested_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    approved_at                TIMESTAMPTZ,
    activated_at               TIMESTAMPTZ,
    suspended_at               TIMESTAMPTZ,
    expires_at                 TIMESTAMPTZ  NOT NULL,
    terminated_at              TIMESTAMPTZ,

    -- Approval metadata (F12.11 governance_policy_version captured at approval).
    approved_by_principal_id   UUID         REFERENCES identity.principals(id),
    governance_policy_version  VARCHAR(64),

    -- Use-case declaration as submitted (F12.5, F12.6). Immutable after create.
    use_case_category          VARCHAR(128) NOT NULL,
    purpose_elaboration        TEXT         NOT NULL,
    intended_scope             JSONB        NOT NULL,
    data_category_constraints  JSONB,
    requested_duration_days    INTEGER      NOT NULL CHECK (requested_duration_days > 0),

    -- Approved shape (F12.11). Set at activation; may narrow the intended scope.
    approved_scope             JSONB,
    approved_data_category_constraints JSONB,
    approved_duration_days     INTEGER      CHECK (approved_duration_days IS NULL OR approved_duration_days > 0),
    modified_by_approver       BOOLEAN      NOT NULL DEFAULT FALSE,

    -- Denial record (F12.12). Populated when state = revoked and transitioned
    -- directly from pending (i.e. denied rather than revoked-after-activation).
    denial_reason              TEXT,
    denied_by_principal_id     UUID         REFERENCES identity.principals(id),

    created_at                 TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- Approved fields must all be present together once the reference activates,
    -- and all absent while pending. Enforced via a partial check: once approved_at
    -- is non-null, approved_scope and approved_duration_days must be populated.
    CONSTRAINT connection_references_approved_consistency
        CHECK (
            (approved_at IS NULL AND approved_scope IS NULL AND approved_duration_days IS NULL
             AND approved_by_principal_id IS NULL)
            OR
            (approved_at IS NOT NULL AND approved_scope IS NOT NULL
             AND approved_duration_days IS NOT NULL AND approved_by_principal_id IS NOT NULL)
        ),

    -- Denial is recorded only when the reference terminates from pending without
    -- ever being activated. denied_by and reason must be consistent.
    CONSTRAINT connection_references_denial_consistency
        CHECK (
            (denial_reason IS NULL AND denied_by_principal_id IS NULL)
            OR
            (denial_reason IS NOT NULL AND denied_by_principal_id IS NOT NULL)
        )
);

-- Indices.
-- Primary enforcement lookup at the Agent Query Layer (ADR-006): given
-- (org_id, agent_id, product_id), find the one active reference. Partial index
-- keeps the hot path index small — only active rows are candidates.
CREATE INDEX connection_references_active_idx
    ON consent.connection_references (org_id, agent_id, product_id)
    WHERE state = 'active';

-- Pending-approvals queue per owning principal (F12.10 routing).
CREATE INDEX connection_references_pending_approval_idx
    ON consent.connection_references (org_id, owning_principal_id)
    WHERE state = 'pending';

-- Expiration workflow (F12.22, NF12.4): scan active references by expires_at.
CREATE INDEX connection_references_expiration_idx
    ON consent.connection_references (expires_at)
    WHERE state = 'active';

-- Grant revocation cascade (F12.21): find all references for a revoked grant.
CREATE INDEX connection_references_access_grant_idx
    ON consent.connection_references (access_grant_id)
    WHERE state IN ('pending', 'active', 'suspended');

-- MAJOR version suspension fan-out (F12.15): find active references for a product.
CREATE INDEX connection_references_product_active_idx
    ON consent.connection_references (org_id, product_id)
    WHERE state = 'active';

-- Generic org filter (RLS helper for planner).
CREATE INDEX connection_references_org_id_idx
    ON consent.connection_references (org_id);

-- ---------------------------------------------------------------------------
-- Connection reference outbox (ADR-007)
--
-- Transactional-outbox rows written in the same transaction as each state
-- transition on consent.connection_references. A background publisher reads
-- unpublished rows and emits to the Redpanda topic `connection_reference.state`.
-- Rows are retained 7 days after publish for replay capability, then cleaned up.
--
-- This migration creates the table only. The publisher worker, the Redpanda
-- topic configuration, and the consumer at the Agent Query Layer land in
-- separate F-IDs (F12.13 and later Domain-12 F-IDs).
-- ---------------------------------------------------------------------------
CREATE TABLE consent.connection_reference_outbox (
    id           BIGSERIAL    PRIMARY KEY,
    org_id       UUID         NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    event_type   VARCHAR(64)  NOT NULL,
    payload      JSONB        NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ
);

-- Publisher picks up unpublished rows in creation order.
CREATE INDEX connection_reference_outbox_unpublished_idx
    ON consent.connection_reference_outbox (created_at)
    WHERE published_at IS NULL;

-- Cleanup job windows by published_at.
CREATE INDEX connection_reference_outbox_published_idx
    ON consent.connection_reference_outbox (published_at)
    WHERE published_at IS NOT NULL;

CREATE INDEX connection_reference_outbox_org_id_idx
    ON consent.connection_reference_outbox (org_id);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
ALTER TABLE consent.connection_references        ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent.connection_reference_outbox  ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA consent TO provenance_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON consent.connection_references       TO provenance_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON consent.connection_reference_outbox TO provenance_app;
GRANT USAGE, SELECT ON SEQUENCE consent.connection_reference_outbox_id_seq  TO provenance_app;

CREATE POLICY connection_references_org_isolation ON consent.connection_references
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

CREATE POLICY connection_reference_outbox_org_isolation ON consent.connection_reference_outbox
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
CREATE TRIGGER connection_references_updated_at
    BEFORE UPDATE ON consent.connection_references
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
