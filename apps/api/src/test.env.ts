// Jest setup: provide minimum required env vars so getConfig() does not process.exit.
process.env['DATABASE_HOST'] = 'localhost';
process.env['DATABASE_NAME'] = 'test';
process.env['DATABASE_USER'] = 'test';
process.env['DATABASE_PASSWORD'] = 'test';
process.env['KEYCLOAK_REALM'] = 'test';
process.env['KEYCLOAK_AUTH_SERVER_URL'] = 'http://localhost:8080';
process.env['KEYCLOAK_CLIENT_ID'] = 'test';
