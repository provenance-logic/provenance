-- Migration V14: Add keycloak_client_provisioned flag to agent_identities
-- ADR-002 Phase 5c-10: tracks which agents have been provisioned with
-- Keycloak client credentials. Existing agents default to false.

ALTER TABLE identity.agent_identities
    ADD COLUMN keycloak_client_provisioned BOOLEAN NOT NULL DEFAULT FALSE;
