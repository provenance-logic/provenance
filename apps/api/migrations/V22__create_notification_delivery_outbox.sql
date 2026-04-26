-- Migration V22: Notification delivery outbox (Domain 11 — F11.2 email channel tier)
--
-- Adds the transactional outbox that drives out-of-band notification delivery
-- (email today, webhook in PR #4). The outbox row is written in the same
-- transaction as the parent notifications.notifications row so the "commit
-- happened iff a delivery is queued" invariant holds (ADR-009 §2). A
-- background worker (NotificationDeliveryWorker) drains pending rows on a
-- 30-second cadence using SELECT ... FOR UPDATE SKIP LOCKED so multiple API
-- instances cannot race for the same row.
--
-- RLS posture: this table is INTERNAL queue infrastructure. The user-facing
-- notifications.notifications table retains RLS for principal-scoped reads,
-- but the outbox itself has no RLS enabled. The worker is cron-driven (no
-- per-request org context) and needs to scan across orgs in a single pass.
-- This matches the existing precedent: observability.trust_score_history is
-- written by a cross-org cron and is also RLS-free.
--
-- Self-containment: rendering inputs (category, payload, deep_link) are
-- snapshotted onto the outbox row at enqueue time so the worker never
-- needs to JOIN against notifications.notifications. This avoids needing
-- to set an RLS org context inside the worker and lets us add channel-
-- specific renderers without coupling them to the user-facing read path.
--
-- Scope of this migration:
--   F11.2 email channel — adds the outbox table the worker drains
--
-- Deferred to later migrations / F-IDs:
--   F11.2 webhook channel — same table; PR #4 only adds worker logic
--   F11.3 principal preferences and per-org channel defaults
--   per-org SMTP configuration (deferred per ADR-009 implementation note;
--                               existing platform-wide EmailService is reused)
--
-- Architecture: ADR-009.

CREATE TABLE notifications.delivery_outbox (
    id                BIGSERIAL    PRIMARY KEY,
    notification_id   UUID         NOT NULL REFERENCES notifications.notifications(id) ON DELETE CASCADE,
    org_id            UUID         NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,

    -- Channel enum is enforced at the application layer for the same reason
    -- the category column on notifications.notifications is free-text: keep
    -- migrations decoupled from the TS enum.
    channel           VARCHAR(32)  NOT NULL
                            CHECK (channel IN ('email', 'webhook')),

    -- Snapshotted destination. Email address for channel='email', webhook URL
    -- for channel='webhook'. Updated principal profile / preferences do not
    -- change this row.
    target            TEXT         NOT NULL,

    -- Snapshotted rendering inputs. Mirror the parent notification's
    -- category/payload/deep_link so the worker can render without a JOIN
    -- (which would require setting an RLS org context per-row).
    category          VARCHAR(64)  NOT NULL,
    payload           JSONB        NOT NULL,
    deep_link         TEXT         NOT NULL,

    attempt_count     INTEGER      NOT NULL DEFAULT 0
                            CHECK (attempt_count >= 0),

    -- The worker only picks rows where next_attempt_at <= now() AND
    -- delivered_at IS NULL AND failed_at IS NULL. Initial value is now() so
    -- a freshly queued row is immediately eligible.
    next_attempt_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    delivered_at      TIMESTAMPTZ,
    failed_at         TIMESTAMPTZ,
    last_error        TEXT,

    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- Delivered and failed are mutually exclusive — a row is in exactly one of
    -- pending / delivered / failed state at any time.
    CONSTRAINT delivery_outbox_status_consistency
        CHECK (NOT (delivered_at IS NOT NULL AND failed_at IS NOT NULL))
);

-- Worker hot path: claim oldest-eligible-first. Partial index keeps the index
-- small — only pending rows are candidates.
CREATE INDEX delivery_outbox_pending_idx
    ON notifications.delivery_outbox (next_attempt_at)
    WHERE delivered_at IS NULL AND failed_at IS NULL;

-- Cleanup: delivered rows older than retention threshold.
CREATE INDEX delivery_outbox_delivered_idx
    ON notifications.delivery_outbox (delivered_at)
    WHERE delivered_at IS NOT NULL;

-- Operational visibility: failed rows surfaced in admin / preferences UI.
CREATE INDEX delivery_outbox_failed_idx
    ON notifications.delivery_outbox (org_id, failed_at)
    WHERE failed_at IS NOT NULL;

-- Reverse lookup: all delivery rows for a given notification (e.g. UI
-- showing "your notification was delivered to email and webhook").
CREATE INDEX delivery_outbox_notification_idx
    ON notifications.delivery_outbox (notification_id);

CREATE INDEX delivery_outbox_org_id_idx
    ON notifications.delivery_outbox (org_id);

-- ---------------------------------------------------------------------------
-- Grants. RLS intentionally NOT enabled — see header comment.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications.delivery_outbox TO provenance_app;
GRANT USAGE, SELECT ON SEQUENCE notifications.delivery_outbox_id_seq TO provenance_app;
