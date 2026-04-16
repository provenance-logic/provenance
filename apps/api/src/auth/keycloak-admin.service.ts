import { Injectable, Logger } from '@nestjs/common';
import { getConfig } from '../config.js';

export interface AgentClientCredentials {
  keycloak_client_id: string;
  keycloak_client_secret: string;
}

@Injectable()
export class KeycloakAdminService {
  private readonly logger = new Logger(KeycloakAdminService.name);
  private readonly baseUrl: string;
  private readonly realm: string;
  private readonly adminClientId: string;
  private readonly adminClientSecret: string;

  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor() {
    const config = getConfig();
    this.baseUrl = config.KEYCLOAK_ADMIN_URL ?? config.KEYCLOAK_AUTH_SERVER_URL;
    this.realm = config.KEYCLOAK_REALM;
    this.adminClientId = config.KEYCLOAK_ADMIN_CLIENT_ID ?? 'provenance-agent-provisioner';
    this.adminClientSecret = config.KEYCLOAK_ADMIN_CLIENT_SECRET ?? '';
  }

  async createAgentClient(
    agentId: string,
    orgId: string,
  ): Promise<AgentClientCredentials> {
    const token = await this.getAdminToken();

    const clientPayload = {
      clientId: agentId,
      enabled: true,
      publicClient: false,
      serviceAccountsEnabled: true,
      standardFlowEnabled: false,
      implicitFlowEnabled: false,
      directAccessGrantsEnabled: false,
      protocol: 'openid-connect',
      protocolMappers: [
        this.hardcodedClaimMapper('principal_type', 'ai_agent'),
        this.hardcodedClaimMapper('agent_id', agentId),
        this.hardcodedClaimMapper('provenance_org_id', orgId),
        {
          name: 'audience',
          protocol: 'openid-connect',
          protocolMapper: 'oidc-audience-mapper',
          config: {
            'included.client.audience': 'provenance-api',
            'id.token.claim': 'false',
            'access.token.claim': 'true',
          },
        },
      ],
    };

    const createRes = await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/clients`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(clientPayload),
      },
    );

    if (!createRes.ok) {
      if (createRes.status === 409) {
        throw new Error(`Keycloak client for agent ${agentId} already exists`);
      }
      throw new Error(`Failed to create Keycloak client: ${createRes.status}`);
    }

    const location = createRes.headers.get('location') ?? '';
    const internalId = location.substring(location.lastIndexOf('/') + 1);

    const secretRes = await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/clients/${internalId}/client-secret`,
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
      },
    );

    if (!secretRes.ok) {
      throw new Error(`Failed to retrieve client secret: ${secretRes.status}`);
    }

    const secretBody = await secretRes.json() as { value: string };

    return {
      keycloak_client_id: agentId,
      keycloak_client_secret: secretBody.value,
    };
  }

  async deleteAgentClient(agentId: string): Promise<void> {
    const token = await this.getAdminToken();
    const internalId = await this.resolveInternalId(token, agentId);

    const res = await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/clients/${internalId}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      },
    );

    if (!res.ok) {
      throw new Error(`Failed to delete Keycloak client: ${res.status}`);
    }
  }

  async rotateClientSecret(agentId: string): Promise<AgentClientCredentials> {
    const token = await this.getAdminToken();
    const internalId = await this.resolveInternalId(token, agentId);

    const res = await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/clients/${internalId}/client-secret`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      },
    );

    if (!res.ok) {
      throw new Error(`Failed to rotate client secret: ${res.status}`);
    }

    const body = await res.json() as { value: string };

    return {
      keycloak_client_id: agentId,
      keycloak_client_secret: body.value,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async getAdminToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }

    const res = await fetch(
      `${this.baseUrl}/realms/${this.realm}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=client_credentials&client_id=${encodeURIComponent(this.adminClientId)}&client_secret=${encodeURIComponent(this.adminClientSecret)}`,
      },
    );

    if (!res.ok) {
      throw new Error(`Failed to acquire Keycloak admin token: ${res.status}`);
    }

    const body = await res.json() as { access_token: string; expires_in: number };
    // Cache with a 30-second safety margin
    this.cachedToken = body.access_token;
    this.tokenExpiresAt = Date.now() + (body.expires_in - 30) * 1000;

    return this.cachedToken;
  }

  private async resolveInternalId(token: string, clientId: string): Promise<string> {
    const res = await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/clients?clientId=${encodeURIComponent(clientId)}`,
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
      },
    );

    if (!res.ok) {
      throw new Error(`Failed to look up Keycloak client: ${res.status}`);
    }

    const clients = await res.json() as Array<{ id: string; clientId: string }>;
    const match = clients.find((c) => c.clientId === clientId);
    if (!match) {
      throw new Error(`Keycloak client for agent ${clientId} not found`);
    }

    return match.id;
  }

  private hardcodedClaimMapper(claimName: string, claimValue: string) {
    return {
      name: claimName,
      protocol: 'openid-connect',
      protocolMapper: 'oidc-hardcoded-claim-mapper',
      config: {
        'claim.name': claimName,
        'claim.value': claimValue,
        'jsonType.label': 'String',
        'id.token.claim': 'true',
        'access.token.claim': 'true',
      },
    };
  }
}
