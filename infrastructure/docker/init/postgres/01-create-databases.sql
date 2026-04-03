-- PostgreSQL initialization: create separate databases for Keycloak and Kong
-- so they share the same PostgreSQL instance without schema collisions.
-- The provenance database (for the control plane) is created by POSTGRES_DB in docker-compose.yml.

CREATE DATABASE keycloak;
CREATE DATABASE kong;

-- Grant the provenance user access to all three databases.
GRANT ALL PRIVILEGES ON DATABASE keycloak TO provenance;
GRANT ALL PRIVILEGES ON DATABASE kong TO provenance;
