-- PostgreSQL initialization: create separate databases for Keycloak and Kong
-- so they share the same PostgreSQL instance without schema collisions.
-- The meshos database (for the control plane) is created by POSTGRES_DB in docker-compose.yml.

CREATE DATABASE keycloak;
CREATE DATABASE kong;

-- Grant the meshos user access to all three databases.
GRANT ALL PRIVILEGES ON DATABASE keycloak TO meshos;
GRANT ALL PRIVILEGES ON DATABASE kong TO meshos;
