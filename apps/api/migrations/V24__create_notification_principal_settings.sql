-- Migration V24: Per-principal notification settings (Domain 11 — F11.2 webhook channel)
--
-- Adds the per-principal settings table that holds the outbound webhook URL
-- for the webhook delivery channel (PR #4). Distinct from
-- notifications.principal_preferences (V23) which is per-(principal, category):
-- this table is one row per principal and captures cross-category settings.
--
-- Scope of this migration:
--   F11.2 webhook channel — adds the URL storage the worker reads at enqueue
--                           time when resolving a webhook delivery target
--
-- Architecture: ADR-009 (with implementation note that webhook URL is
-- per-principal, not per-category as originally sketched in §7).

CREATE TABLE notifications.principal_settings (
    org_id        UUID         NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    principal_id  UUID         PRIMARY KEY REFERENCES identity.principals(id) ON DELETE CASCADE,

    -- Outbound webhook URL. Null means the principal has not configured a
    -- webhook; in that case the worker silently skips webhook delivery (the
    -- in-platform notification row still appears).
    --
    -- Length cap is generous — Slack incoming webhook URLs run ~120 chars,
    -- PagerDuty Events API URLs ~80 chars; 2000 covers any reasonable URL.
    webhook_url   VARCHAR(2000),

    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX principal_settings_org_idx
    ON notifications.principal_settings (org_id);

ALTER TABLE notifications.principal_settings ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON notifications.principal_settings TO provenance_app;

CREATE POLICY principal_settings_org_isolation ON notifications.principal_settings
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

CREATE TRIGGER principal_settings_updated_at
    BEFORE UPDATE ON notifications.principal_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
