-- Migration V13: Add agent-specific fields to audit log for MCP tool call tracking.
-- These columns support B3 (activity tracking) and B4 (oversight enforcement).
-- The existing columns (principal_type, action, metadata) remain unchanged.

ALTER TABLE audit.audit_log
    ADD COLUMN agent_id UUID,
    ADD COLUMN agent_trust_classification_at_time VARCHAR(50),
    ADD COLUMN human_oversight_contact VARCHAR(255),
    ADD COLUMN tool_name VARCHAR(255),
    ADD COLUMN mcp_input_summary TEXT;

-- Index for per-agent activity queries (oversight dashboard, activity counts)
CREATE INDEX audit_log_agent_id_idx ON audit.audit_log (agent_id, occurred_at DESC)
    WHERE agent_id IS NOT NULL;
