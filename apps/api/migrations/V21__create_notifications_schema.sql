-- Migration V21: Notifications schema (Domain 11 — F11.1, F11.4, F11.5 in-platform tier)
--
-- Introduces the in-platform notification inbox: the canonical record for any
-- notification routed through the platform. The notification row itself IS the
-- in-platform delivery (ADR-009 §2). Email and webhook channels land in
-- subsequent migrations along with the delivery outbox, principal preferences,
-- and per-org SMTP config — all explicitly out of scope here.
--
-- Scope of this migration:
--   F11.1 — notification service (data layer foundation only)
--   F11.4 — notification center UI (the inbox table this query reads from)
--   F11.5 — deduplication via the (org_id, category, dedup_key) lookup
--
-- Deferred to later migrations / F-IDs:
--   F11.2 (email/webhook channels) — adds notifications.delivery_outbox,
--         notifications.org_email_config, retry mechanics
--   F11.3 (per-principal preferences) — adds notifications.principal_preferences
--         and notifications.org_category_defaults
--   F11.6 – F11.27 (trigger wiring) — application-layer only; no schema impact
--
-- Architecture: ADR-009.

CREATE SCHEMA IF NOT EXISTS notifications;

-- ---------------------------------------------------------------------------
-- Notifications inbox
--
-- One row per (recipient, dedup window) tuple. Trigger modules call
-- NotificationsService.enqueue() with a pre-resolved recipient list
-- (ADR-009 §3 — recipients are snapshotted at trigger time, not resolved
-- lazily). The service writes one row per recipient.
--
-- Dedup is enforced at the application layer via a (org_id, category,
-- dedup_key) lookup over rows created within the configured dedup window.
-- A duplicate increments dedup_count on the existing row instead of
-- inserting a new one. The (org_id, category, dedup_key, created_at)
-- index supports that lookup.
--
-- Retention: NF11.5 — 90 days. Cleanup runs via a scheduled task, not
-- declared here.
-- ---------------------------------------------------------------------------
CREATE TABLE notifications.notifications (
    id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                   UUID         NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    recipient_principal_id   UUID         NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,

    -- Category enum is enforced at the application layer (TS union in
    -- @provenance/types). A CHECK constraint here would couple migrations
    -- to the application enum and force a migration every time a new
    -- category is added — keeping the column free-text avoids that
    -- without losing safety, since every write goes through the typed
    -- service interface.
    category                 VARCHAR(64)  NOT NULL,

    payload                  JSONB        NOT NULL,
    deep_link                TEXT         NOT NULL,

    -- Stable per-trigger key. Trigger module chooses the key shape so that
    -- events that should collapse together share a key, and events that
    -- should not collapse have unique keys.
    dedup_key                TEXT         NOT NULL,

    -- Count of suppressed duplicates. 1 means "this is the only
    -- occurrence." Bumped by the application on dedup hit.
    dedup_count              INTEGER      NOT NULL DEFAULT 1
                                  CHECK (dedup_count >= 1),

    read_at                  TIMESTAMPTZ,
    dismissed_at             TIMESTAMPTZ,

    created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Inbox query for the notification center UI: list this principal's
-- notifications most-recent-first, optionally filtered by category and
-- read/dismissed state. The dismissed_at filter is most-selective (most
-- rows are not dismissed) so we keep it out of the index — the recency
-- ordering makes the index pay for itself anyway.
CREATE INDEX notifications_recipient_recency_idx
    ON notifications.notifications (org_id, recipient_principal_id, created_at DESC);

-- Dedup lookup. Partial index restricted to a 24-hour window via a
-- predicate would tighten the index further, but PostgreSQL does not
-- allow NOW() in partial-index predicates. Instead the query bounds
-- created_at at lookup time. Index ordering is (org_id, category,
-- dedup_key, created_at DESC) so the lookup walks recent rows for
-- the matching key.
CREATE INDEX notifications_dedup_idx
    ON notifications.notifications (org_id, category, dedup_key, created_at DESC);

-- Cleanup job (NF11.5 retention) scans by created_at across the table.
CREATE INDEX notifications_created_at_idx
    ON notifications.notifications (created_at);

-- Generic org filter (RLS planner helper).
CREATE INDEX notifications_org_id_idx
    ON notifications.notifications (org_id);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
ALTER TABLE notifications.notifications ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA notifications TO provenance_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications.notifications TO provenance_app;

CREATE POLICY notifications_org_isolation ON notifications.notifications
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

-- ---------------------------------------------------------------------------
-- updated_at trigger (function declared in V1)
-- ---------------------------------------------------------------------------
CREATE TRIGGER notifications_updated_at
    BEFORE UPDATE ON notifications.notifications
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
