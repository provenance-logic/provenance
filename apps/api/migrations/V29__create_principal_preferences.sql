-- Migration V29: Per-principal generic preferences (F7.46)
--
-- Stores a JSONB blob of per-principal application preferences. Initial use:
-- the F7.46 onboarding wizard's progress state (completed_steps, skipped_steps,
-- dismissed_at, completed_at). Future uses anticipated: UI layout
-- preferences, default filters in the marketplace, etc.
--
-- Distinct from notifications.principal_preferences (V23), which is a
-- per-(principal, category) row-per-preference shape for notification opt-out
-- and channel overrides. This table is a single JSONB row per principal for
-- arbitrary preference shapes that don't merit dedicated columns.
--
-- Why JSONB rather than dedicated columns: onboarding wizard state will
-- grow (steps added, deferrals resolved, sample-data flag added later). A
-- single-column JSONB lets us evolve the shape without a migration per
-- preference. The shape is owned by @provenance/types
-- (PrincipalPreferences interface) so the API stays type-safe.
--
-- RLS isolates rows by org_id (same as every other tenant-scoped table on
-- the platform), and the application layer further restricts reads/writes
-- to the calling principal's own row (a principal cannot read or write
-- another principal's preferences, even within the same org).

CREATE TABLE identity.principal_preferences (
    principal_id  UUID         NOT NULL PRIMARY KEY
                  REFERENCES identity.principals(id) ON DELETE CASCADE,
    org_id        UUID         NOT NULL
                  REFERENCES organizations.orgs(id) ON DELETE RESTRICT,

    -- Open shape; the API layer accepts and returns a typed
    -- PrincipalPreferences interface (packages/types).
    preferences   JSONB        NOT NULL DEFAULT '{}'::JSONB,

    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX principal_preferences_org_idx
    ON identity.principal_preferences (org_id);

ALTER TABLE identity.principal_preferences ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON identity.principal_preferences TO provenance_app;

CREATE POLICY principal_preferences_org_isolation ON identity.principal_preferences
    FOR ALL TO provenance_app
    USING (org_id = current_setting('provenance.current_org_id', true)::UUID);

CREATE TRIGGER principal_preferences_updated_at
    BEFORE UPDATE ON identity.principal_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
