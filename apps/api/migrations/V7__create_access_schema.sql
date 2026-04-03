-- Migration V7: Access schema
-- Consumer-product access grants, access request workflow, and approval audit trail.
-- access_grants: mutable — can be revoked; expires_at tracks expiration.
-- access_requests: mutable — transitions through status states via Temporal workflow.
-- approval_events: append-only — immutable audit trail of every approval action.

CREATE SCHEMA IF NOT EXISTS access;

-- ---------------------------------------------------------------------------
-- Access grants
-- An active access relationship between a consumer principal and a data product.
-- Created when an access request is approved, or granted directly by a domain owner.
-- Revocable at any time. Expires automatically at expires_at if set.
-- access_scope optionally restricts access to specific ports or fields.
-- ---------------------------------------------------------------------------
CREATE TABLE access.access_grants (
    id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                UUID         NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    product_id            UUID         NOT NULL REFERENCES products.data_products(id) ON DELETE RESTRICT,
    grantee_principal_id  UUID         NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    granted_by            UUID         REFERENCES identity.principals(id),   -- NULL for system-auto-approved grants
    granted_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at            TIMESTAMPTZ,                                        -- NULL means indefinite
    revoked_at            TIMESTAMPTZ,
    revoked_by            UUID         REFERENCES identity.principals(id),
    access_scope          JSONB,                                              -- NULL means full product access;
                                                                             -- non-NULL restricts to listed ports/fields
    approval_request_id   UUID                                               -- FK added below after access_requests is created
);

CREATE INDEX access_grants_org_id_idx      ON access.access_grants (org_id);
CREATE INDEX access_grants_product_idx     ON access.access_grants (product_id);
CREATE INDEX access_grants_grantee_idx     ON access.access_grants (grantee_principal_id);
-- Partial index for fast active-grant lookups during policy evaluation.
-- Expiry enforcement by timestamp is handled at the application layer.
CREATE INDEX access_grants_active_idx      ON access.access_grants (org_id, product_id, grantee_principal_id)
    WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Access requests
-- A consumer's request to access a data product. Transitions through a
-- state machine managed by a Temporal approval workflow.
-- Domain owners receive a notification and approve or deny via the UI.
-- ---------------------------------------------------------------------------
CREATE TABLE access.access_requests (
    id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                UUID         NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    product_id            UUID         NOT NULL REFERENCES products.data_products(id) ON DELETE RESTRICT,
    requester_principal_id UUID        NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    justification         TEXT,                                               -- why access is needed
    access_scope          JSONB,                                              -- requested scope; NULL means full access
    status                VARCHAR(32)  NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'approved', 'denied', 'withdrawn')),
    temporal_workflow_id  VARCHAR(255),                                       -- Temporal workflow tracking approval
    requested_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    resolved_at           TIMESTAMPTZ,
    resolved_by           UUID         REFERENCES identity.principals(id),
    resolution_note       TEXT,
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX access_requests_org_id_idx     ON access.access_requests (org_id);
CREATE INDEX access_requests_product_idx    ON access.access_requests (product_id);
CREATE INDEX access_requests_requester_idx  ON access.access_requests (requester_principal_id);
CREATE INDEX access_requests_status_idx     ON access.access_requests (org_id, status)
    WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- Approval events
-- Append-only audit trail of every action taken on an access request.
-- One row per action: submitted, approved, denied, withdrawn, escalated, expired.
-- performed_by is NULL for system-generated events (e.g. workflow timeout).
-- ---------------------------------------------------------------------------
CREATE TABLE access.approval_events (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID         NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    request_id    UUID         NOT NULL REFERENCES access.access_requests(id) ON DELETE RESTRICT,
    action        VARCHAR(32)  NOT NULL
                      CHECK (action IN ('submitted', 'approved', 'denied', 'withdrawn', 'escalated', 'expired')),
    performed_by  UUID         REFERENCES identity.principals(id),           -- NULL for system actions
    note          TEXT,
    occurred_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX approval_events_request_idx ON access.approval_events (request_id, occurred_at DESC);
CREATE INDEX approval_events_org_idx     ON access.approval_events (org_id, occurred_at DESC);

-- Append-only — approval audit trail is never modified.
REVOKE UPDATE, DELETE ON access.approval_events FROM provenance_app;

-- ---------------------------------------------------------------------------
-- Back-reference: access_grants.approval_request_id → access_requests
-- Added after access_requests is created to avoid forward-reference.
-- ---------------------------------------------------------------------------
ALTER TABLE access.access_grants
    ADD CONSTRAINT access_grants_approval_request_fk
    FOREIGN KEY (approval_request_id) REFERENCES access.access_requests(id);

CREATE INDEX access_grants_request_idx ON access.access_grants (approval_request_id)
    WHERE approval_request_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
ALTER TABLE access.access_grants   ENABLE ROW LEVEL SECURITY;
ALTER TABLE access.access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE access.approval_events ENABLE ROW LEVEL SECURITY;

-- Permissions — approval_events excludes UPDATE and DELETE.
GRANT USAGE ON SCHEMA access TO provenance_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON access.access_grants   TO provenance_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON access.access_requests TO provenance_app;
GRANT SELECT, INSERT                 ON access.approval_events TO provenance_app;

CREATE POLICY access_grants_org_isolation ON access.access_grants
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

CREATE POLICY access_requests_org_isolation ON access.access_requests
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

CREATE POLICY approval_events_org_isolation ON access.approval_events
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

-- ---------------------------------------------------------------------------
-- updated_at triggers — mutable tables only.
-- approval_events is append-only; no trigger needed.
-- ---------------------------------------------------------------------------
CREATE TRIGGER access_grants_updated_at
    BEFORE UPDATE ON access.access_grants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER access_requests_updated_at
    BEFORE UPDATE ON access.access_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
