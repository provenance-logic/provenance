import { KeycloakAdminService } from './keycloak-admin.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fake token response from Keycloak token endpoint */
function fakeTokenResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      access_token: 'admin-access-token',
      expires_in: 300,
      token_type: 'Bearer',
    }),
  } as unknown as Response;
}

/** Fake successful client creation response (201) */
function fakeCreateClientResponse() {
  return {
    ok: true,
    status: 201,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'location'
          ? 'http://localhost:8080/admin/realms/provenance/clients/keycloak-internal-id'
          : null,
    },
  } as unknown as Response;
}

/** Fake get-client-secret response */
function fakeSecretResponse(secret: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ type: 'secret', value: secret }),
  } as unknown as Response;
}

/** Fake 409 response for duplicate client */
function fakeConflictResponse() {
  return {
    ok: false,
    status: 409,
    json: async () => ({ errorMessage: 'Client provenance-api already exists' }),
  } as unknown as Response;
}

/** Fake 401 response for expired admin token */
function fakeUnauthorizedResponse() {
  return {
    ok: false,
    status: 401,
    json: async () => ({ error: 'invalid_token' }),
  } as unknown as Response;
}

/** Fake 204 response (used for delete) */
function fakeNoContentResponse() {
  return {
    ok: true,
    status: 204,
  } as unknown as Response;
}

/** Fake client list response for getClientByClientId */
function fakeClientListResponse(clients: Array<{ id: string; clientId: string }>) {
  return {
    ok: true,
    status: 200,
    json: async () => clients,
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('KeycloakAdminService', () => {
  let service: KeycloakAdminService;
  let fetchSpy: jest.SpyInstance;

  const agentId = '550e8400-e29b-41d4-a716-446655440000';
  const orgId = '660e8400-e29b-41d4-a716-446655440001';

  beforeEach(() => {
    service = new KeycloakAdminService();
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // createAgentClient
  // -------------------------------------------------------------------------

  describe('createAgentClient', () => {
    it('acquires an admin token and creates a Keycloak client with correct payload', async () => {
      fetchSpy
        .mockResolvedValueOnce(fakeTokenResponse())       // admin token
        .mockResolvedValueOnce(fakeCreateClientResponse()) // create client
        .mockResolvedValueOnce(fakeSecretResponse('generated-secret')); // get secret

      const result = await service.createAgentClient(agentId, orgId);

      // Should have made 3 fetch calls
      expect(fetchSpy).toHaveBeenCalledTimes(3);

      // 1st call: token endpoint
      const [tokenUrl, tokenOpts] = fetchSpy.mock.calls[0];
      expect(tokenUrl).toContain('/realms/provenance/protocol/openid-connect/token');
      expect(tokenOpts.method).toBe('POST');
      expect(tokenOpts.body).toContain('grant_type=client_credentials');

      // 2nd call: create client
      const [createUrl, createOpts] = fetchSpy.mock.calls[1];
      expect(createUrl).toContain('/admin/realms/provenance/clients');
      expect(createOpts.method).toBe('POST');
      expect(createOpts.headers['Authorization']).toBe('Bearer admin-access-token');

      const body = JSON.parse(createOpts.body);
      expect(body.clientId).toBe(agentId);
      expect(body.serviceAccountsEnabled).toBe(true);
      expect(body.directAccessGrantsEnabled).toBe(false);
      expect(body.publicClient).toBe(false);
      expect(body.standardFlowEnabled).toBe(false);

      // Result
      expect(result.keycloak_client_id).toBe(agentId);
      expect(result.keycloak_client_secret).toBe('generated-secret');
    });

    it('includes protocol mappers for principal_type, agent_id, and provenance_org_id', async () => {
      fetchSpy
        .mockResolvedValueOnce(fakeTokenResponse())
        .mockResolvedValueOnce(fakeCreateClientResponse())
        .mockResolvedValueOnce(fakeSecretResponse('secret'));

      await service.createAgentClient(agentId, orgId);

      const [, createOpts] = fetchSpy.mock.calls[1];
      const body = JSON.parse(createOpts.body);
      const mappers: Array<{ name: string; protocol: string; protocolMapper: string; config: Record<string, string> }> = body.protocolMappers;

      expect(mappers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'principal_type',
            protocolMapper: 'oidc-hardcoded-claim-mapper',
            config: expect.objectContaining({
              'claim.value': 'ai_agent',
              'claim.name': 'principal_type',
            }),
          }),
          expect.objectContaining({
            name: 'agent_id',
            protocolMapper: 'oidc-hardcoded-claim-mapper',
            config: expect.objectContaining({
              'claim.value': agentId,
              'claim.name': 'agent_id',
            }),
          }),
          expect.objectContaining({
            name: 'provenance_org_id',
            protocolMapper: 'oidc-hardcoded-claim-mapper',
            config: expect.objectContaining({
              'claim.value': orgId,
              'claim.name': 'provenance_org_id',
            }),
          }),
        ]),
      );
    });

    it('sets the audience mapper to provenance-api', async () => {
      fetchSpy
        .mockResolvedValueOnce(fakeTokenResponse())
        .mockResolvedValueOnce(fakeCreateClientResponse())
        .mockResolvedValueOnce(fakeSecretResponse('secret'));

      await service.createAgentClient(agentId, orgId);

      const [, createOpts] = fetchSpy.mock.calls[1];
      const body = JSON.parse(createOpts.body);
      const mappers: Array<{ name: string; protocolMapper: string; config: Record<string, string> }> = body.protocolMappers;

      expect(mappers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'audience',
            protocolMapper: 'oidc-audience-mapper',
            config: expect.objectContaining({
              'included.client.audience': 'provenance-api',
            }),
          }),
        ]),
      );
    });

    it('throws with "already exists" message when Keycloak returns 409', async () => {
      fetchSpy
        .mockResolvedValueOnce(fakeTokenResponse())
        .mockResolvedValueOnce(fakeConflictResponse());

      await expect(service.createAgentClient(agentId, orgId)).rejects.toThrow(
        /already exists/i,
      );
      // Ensure fetch was actually called (not just a skeleton throw)
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('throws if admin token acquisition fails', async () => {
      fetchSpy.mockResolvedValueOnce(fakeUnauthorizedResponse());

      await expect(service.createAgentClient(agentId, orgId)).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // deleteAgentClient
  // -------------------------------------------------------------------------

  describe('deleteAgentClient', () => {
    it('looks up the client by clientId and deletes it', async () => {
      fetchSpy
        .mockResolvedValueOnce(fakeTokenResponse())                                     // admin token
        .mockResolvedValueOnce(fakeClientListResponse([{ id: 'kc-internal-id', clientId: agentId }])) // lookup
        .mockResolvedValueOnce(fakeNoContentResponse());                                // delete

      await service.deleteAgentClient(agentId);

      expect(fetchSpy).toHaveBeenCalledTimes(3);

      // Delete call uses the internal Keycloak ID, not the clientId
      const [deleteUrl, deleteOpts] = fetchSpy.mock.calls[2];
      expect(deleteUrl).toContain('/admin/realms/provenance/clients/kc-internal-id');
      expect(deleteOpts.method).toBe('DELETE');
    });

    it('throws if the client is not found in Keycloak', async () => {
      fetchSpy
        .mockResolvedValueOnce(fakeTokenResponse())
        .mockResolvedValueOnce(fakeClientListResponse([]));

      await expect(service.deleteAgentClient(agentId)).rejects.toThrow(
        /not found/i,
      );
      // Ensure fetch was actually called
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // rotateClientSecret
  // -------------------------------------------------------------------------

  describe('rotateClientSecret', () => {
    it('generates a new secret and returns it', async () => {
      const newSecretResponse = {
        ok: true,
        status: 200,
        json: async () => ({ type: 'secret', value: 'rotated-secret' }),
      } as unknown as Response;

      fetchSpy
        .mockResolvedValueOnce(fakeTokenResponse())                                     // admin token
        .mockResolvedValueOnce(fakeClientListResponse([{ id: 'kc-internal-id', clientId: agentId }])) // lookup
        .mockResolvedValueOnce(newSecretResponse);                                      // regenerate

      const result = await service.rotateClientSecret(agentId);

      expect(result.keycloak_client_secret).toBe('rotated-secret');

      // Regenerate call uses POST to the client-secret endpoint
      const [secretUrl, secretOpts] = fetchSpy.mock.calls[2];
      expect(secretUrl).toContain(`/admin/realms/provenance/clients/kc-internal-id/client-secret`);
      expect(secretOpts.method).toBe('POST');
    });
  });

  // -------------------------------------------------------------------------
  // Admin token caching
  // -------------------------------------------------------------------------

  describe('admin token caching', () => {
    it('reuses a cached admin token for sequential calls within the TTL', async () => {
      fetchSpy
        // First call: token + create + get-secret
        .mockResolvedValueOnce(fakeTokenResponse())
        .mockResolvedValueOnce(fakeCreateClientResponse())
        .mockResolvedValueOnce(fakeSecretResponse('secret-1'))
        // Second call: only create + get-secret (token cached)
        .mockResolvedValueOnce(fakeCreateClientResponse())
        .mockResolvedValueOnce(fakeSecretResponse('secret-2'));

      const agentId2 = '770e8400-e29b-41d4-a716-446655440002';

      await service.createAgentClient(agentId, orgId);
      await service.createAgentClient(agentId2, orgId);

      // Token endpoint should have been called only once
      const tokenCalls = fetchSpy.mock.calls.filter(([url]: [string]) =>
        url.includes('/openid-connect/token'),
      );
      expect(tokenCalls).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  describe('configuration', () => {
    it('reads Keycloak admin URL from config', () => {
      // The service should be constructable with the env vars from test.env.ts
      const svc = new KeycloakAdminService();
      expect(svc).toBeDefined();
    });
  });
});
