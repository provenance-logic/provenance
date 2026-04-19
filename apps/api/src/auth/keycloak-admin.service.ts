import { Injectable } from '@nestjs/common';
import { getConfig } from '../config.js';

export interface AgentClientCredentials {
  keycloak_client_id: string;
  keycloak_client_secret: string;
}

export interface KeycloakUserSummary {
  id: string;
  email: string;
  emailVerified: boolean;
}

@Injectable()
export class KeycloakAdminService {
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
  // Users — invitation acceptance and self-serve registration (F10.1, F10.3)
  // ---------------------------------------------------------------------------

  /**
   * Find a Keycloak user by email address. Returns null if no such user exists.
   * The exact=true query ensures only case-insensitive-exact matches are returned.
   */
  async findUserByEmail(email: string): Promise<KeycloakUserSummary | null> {
    const token = await this.getAdminToken();
    const res = await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/users?email=${encodeURIComponent(email)}&exact=true`,
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
      },
    );
    if (!res.ok) {
      throw new Error(`Failed to query Keycloak users: ${res.status}`);
    }
    const users = await res.json() as Array<{ id: string; email: string; emailVerified?: boolean }>;
    const match = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!match) return null;
    return {
      id: match.id,
      email: match.email,
      emailVerified: match.emailVerified ?? false,
    };
  }

  /**
   * Create a new Keycloak user. Returns the Keycloak user id.
   * The invitation acceptance flow marks emailVerified=true because the
   * invitation link itself proves email ownership; a separate UPDATE_PASSWORD
   * required action is triggered so the invitee sets their own password.
   */
  async createUser(params: {
    email: string;
    firstName?: string;
    lastName?: string;
    emailVerified?: boolean;
    attributes?: Record<string, string[]>;
    requiredActions?: string[];
  }): Promise<string> {
    const token = await this.getAdminToken();
    const payload: Record<string, unknown> = {
      username: params.email,
      email: params.email,
      enabled: true,
      emailVerified: params.emailVerified ?? false,
    };
    if (params.firstName) payload.firstName = params.firstName;
    if (params.lastName) payload.lastName = params.lastName;
    if (params.attributes) payload.attributes = params.attributes;
    if (params.requiredActions) payload.requiredActions = params.requiredActions;

    const res = await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/users`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );
    if (!res.ok) {
      if (res.status === 409) {
        throw new Error(`Keycloak user with email ${params.email} already exists`);
      }
      throw new Error(`Failed to create Keycloak user: ${res.status}`);
    }
    const location = res.headers.get('location') ?? '';
    return location.substring(location.lastIndexOf('/') + 1);
  }

  /**
   * Update a Keycloak user's platform attributes. Used to bind the provenance_*
   * claims (principal_id, org_id, principal_type) so the protocol mappers have
   * values to project into every issued token.
   *
   * Keycloak's PUT /users/{id} replaces the entire user representation — it
   * does not merge. Sending only `{attributes:{...}}` drops email, username,
   * etc. and trips user-profile required-field validation. So GET the current
   * user, merge the incoming attributes into existing attributes, and PUT the
   * complete object back.
   */
  async updateUserAttributes(userId: string, attributes: Record<string, string>): Promise<void> {
    const token = await this.getAdminToken();

    const getRes = await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/users/${encodeURIComponent(userId)}`,
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
      },
    );
    if (!getRes.ok) {
      throw new Error(`Failed to fetch Keycloak user for attribute update: ${getRes.status}`);
    }
    const user = await getRes.json() as Record<string, unknown> & {
      attributes?: Record<string, string[]>;
    };

    const mergedAttributes: Record<string, string[]> = { ...(user.attributes ?? {}) };
    for (const [k, v] of Object.entries(attributes)) {
      mergedAttributes[k] = [v];
    }
    const updated = { ...user, attributes: mergedAttributes };

    const res = await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/users/${encodeURIComponent(userId)}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updated),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Failed to update Keycloak user attributes: ${res.status} ${body}`);
    }
  }

  /**
   * Send an execute-actions email to a Keycloak user. Commonly used to trigger
   * UPDATE_PASSWORD after invitation acceptance so the invitee sets their own
   * password via Keycloak's native flow.
   */
  async executeActionsEmail(
    userId: string,
    actions: string[],
    redirectUri?: string,
  ): Promise<void> {
    const token = await this.getAdminToken();
    const query = redirectUri
      ? `?redirect_uri=${encodeURIComponent(redirectUri)}&client_id=provenance-web`
      : '';
    const res = await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/users/${encodeURIComponent(userId)}/execute-actions-email${query}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(actions),
      },
    );
    if (!res.ok) {
      throw new Error(`Failed to send Keycloak actions email: ${res.status}`);
    }
  }

  /**
   * Assign one or more realm roles to a Keycloak user.
   */
  async assignRealmRoles(userId: string, roleNames: string[]): Promise<void> {
    const token = await this.getAdminToken();

    const rolesRes = await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/roles`,
      { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } },
    );
    if (!rolesRes.ok) {
      throw new Error(`Failed to list realm roles: ${rolesRes.status}`);
    }
    const allRoles = await rolesRes.json() as Array<{ id: string; name: string }>;
    const bindings = allRoles
      .filter((r) => roleNames.includes(r.name))
      .map((r) => ({ id: r.id, name: r.name }));

    if (bindings.length === 0) return;

    const res = await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/users/${encodeURIComponent(userId)}/role-mappings/realm`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bindings),
      },
    );
    if (!res.ok) {
      throw new Error(`Failed to assign realm roles to user: ${res.status}`);
    }
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
