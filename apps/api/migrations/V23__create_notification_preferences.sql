-- Migration V23: Per-principal notification preferences (Domain 11 — F11.3)
--
-- Adds the per-(principal, category) preference table that lets principals
-- opt out of categories or override the channel set for themselves. PR #5
-- consumes this table at enqueue time when resolving the channel set for
-- each recipient (channel-resolver.ts).
--
-- Scope of this migration:
--   F11.3 — per-principal preferences (opt in/out + channel override per category)
--
-- Deferred to later migrations / F-IDs:
--   F11.3 org-level category defaults — adds notifications.org_category_defaults
--   per-principal webhook URL config — bundled with PR #4 (webhook channel)
--
-- Architecture: ADR-009 (with implementation note that channel selection
-- happens at enqueue time, not delivery time, in the current implementation).

CREATE TABLE notifications.principal_preferences (
    org_id        UUID         NOT NULL REFERENCES organizations.orgs(id) ON DELETE RESTRICT,
    principal_id  UUID         NOT NULL REFERENCES identity.principals(id) ON DELETE CASCADE,

    -- Category enum is enforced at the application layer (TS union in
    -- @provenance/types). Same reasoning as notifications.notifications.category.
    category      VARCHAR(64)  NOT NULL,

    -- When false, the principal opts out of this category. Governance-mandatory
    -- categories ignore enabled=false at resolution time and are always
    -- delivered to at least the in-platform channel regardless of preference
    -- (F11.3 — governance-mandated notifications cannot be opted out of).
    enabled       BOOLEAN      NOT NULL DEFAULT TRUE,

    -- Channel override. Empty array means "no override, use the category
    -- default (CATEGORY_DEFAULT_CHANNELS in @provenance/types)." When
    -- non-empty, the resolver uses these channels instead of the default.
    -- The in-platform channel is always re-added by the resolver so the
    -- notification reaches the principal's inbox regardless of override.
    channels      TEXT[]       NOT NULL DEFAULT '{}'::TEXT[],

    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    PRIMARY KEY (principal_id, category)
);

-- Index supports the resolver's hot-path lookup: given a recipient principal,
-- fetch all of their preferences in one round-trip and resolve in memory.
CREATE INDEX principal_preferences_principal_idx
    ON notifications.principal_preferences (principal_id);

-- RLS for tenant isolation. Reads through the REST API are further scoped to
-- the calling principal at the application layer so principals cannot list
-- each other's preferences even within the same org.
ALTER TABLE notifications.principal_preferences ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON notifications.principal_preferences TO provenance_app;

CREATE POLICY principal_preferences_org_isolation ON notifications.principal_preferences
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

CREATE TRIGGER principal_preferences_updated_at
    BEFORE UPDATE ON notifications.principal_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
