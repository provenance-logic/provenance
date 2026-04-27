-- Migration V26: Idempotency marker for the F11.21 grace-period-expiring trigger
--
-- Same pattern as V25 (access notification tracking columns): the time-driven
-- trigger worker stamps a per-row column on successful enqueue, so subsequent
-- cron passes skip rows that already have a notification on file. The 15-minute
-- in-memory dedup window in NotificationsService does not survive across cron
-- passes that run hours or days apart.
--
-- Scope:
--   F11.21 — grace_periods.expiry_warning_sent_at

ALTER TABLE governance.grace_periods
    ADD COLUMN expiry_warning_sent_at TIMESTAMPTZ;

-- Worker hot path: scan pending grace periods that are within the warning
-- window and have not been notified on yet.
CREATE INDEX grace_periods_expiry_warning_pending_idx
    ON governance.grace_periods (org_id, ends_at)
    WHERE outcome = 'pending' AND expiry_warning_sent_at IS NULL;
