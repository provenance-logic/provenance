-- Migration V25: Tracking columns for access-bundle notification idempotency
--
-- The Domain 11 dedup window (DEFAULT_DEDUP_WINDOW_SECONDS, 15 minutes)
-- collapses repeated triggers within a short window, but does not solve
-- "send this notification exactly once" for time-driven triggers that scan
-- on a longer cadence (e.g. once per hour for grant expiry).
--
-- These columns add per-row "already sent" markers so the access trigger
-- worker can skip rows it has already notified on, regardless of how often
-- the cron fires.
--
-- Scope of this migration:
--   F11.9  — sla_warning_sent_at  on access_requests
--   F11.10 — sla_breach_notified_at on access_requests
--   F11.11 — expiry_warning_sent_at on access_grants

ALTER TABLE access.access_requests
    ADD COLUMN sla_warning_sent_at   TIMESTAMPTZ,
    ADD COLUMN sla_breach_notified_at TIMESTAMPTZ;

ALTER TABLE access.access_grants
    ADD COLUMN expiry_warning_sent_at TIMESTAMPTZ;

-- Worker hot path: scan unresolved requests where the warning hasn't been
-- sent. Partial index keeps it small.
CREATE INDEX access_requests_sla_warning_pending_idx
    ON access.access_requests (org_id, requested_at)
    WHERE status = 'pending' AND sla_warning_sent_at IS NULL;

-- Same for SLA breach.
CREATE INDEX access_requests_sla_breach_pending_idx
    ON access.access_requests (org_id, requested_at)
    WHERE status = 'pending' AND sla_breach_notified_at IS NULL;

-- Grant expiry watcher: scan active grants with expiry on the horizon.
CREATE INDEX access_grants_expiry_warning_pending_idx
    ON access.access_grants (org_id, expires_at)
    WHERE revoked_at IS NULL AND expires_at IS NOT NULL AND expiry_warning_sent_at IS NULL;
