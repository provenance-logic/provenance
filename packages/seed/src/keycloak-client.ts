import { request } from 'undici';
import type { SeedConfig } from './config.js';
import type { Logger } from './logger.js';

export interface KeycloakUserSpec {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  attributes: Record<string, string>;
}

export interface KeycloakClientSpec {
  clientId: string;
  name: string;
  serviceAccountAttributes: Record<string, string>;
}

export interface KeycloakAdminClient {
  ensureUser(spec: KeycloakUserSpec): Promise<{ id: string }>;
  ensureClientCredentialsClient(spec: KeycloakClientSpec): Promise<{ clientId: string; clientSecret: string }>;
}

export function createKeycloakClient(config: SeedConfig, logger: Logger): KeycloakAdminClient {
  let cachedToken: { value: string; expiresAt: number } | null = null;
  const realm = config.KEYCLOAK_REALM;

  async function token(): Promise<string> {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 5_000) return cachedToken.value;
    const tokenUrl = `${config.KEYCLOAK_URL}/realms/${realm}/protocol/openid-connect/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.KEYCLOAK_ADMIN_CLIENT_ID,
      client_secret: config.KEYCLOAK_ADMIN_CLIENT_SECRET,
    });
    const res = await request(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (res.statusCode !== 200) {
      const text = await res.body.text();
      throw new Error(`Keycloak admin token exchange failed (${res.statusCode}): ${text.slice(0, 300)}`);
    }
    const payload = (await res.body.json()) as { access_token: string; expires_in: number };
    cachedToken = {
      value: payload.access_token,
      expiresAt: Date.now() + payload.expires_in * 1000,
    };
    return cachedToken.value;
  }

  async function adminCall<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const url = `${config.KEYCLOAK_URL}/admin/realms/${realm}${path}`;
    const res = await request(url, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${await token()}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.body.text();
    if (res.statusCode >= 400) {
      throw new Error(`Keycloak admin ${method} ${path} -> ${res.statusCode}: ${text.slice(0, 300)}`);
    }
    return text.length === 0 ? ({} as T) : (JSON.parse(text) as T);
  }

  return {
    async ensureUser(spec) {
      const existing = await adminCall<Array<{ id: string }>>('GET', `/users?email=${encodeURIComponent(spec.email)}&exact=true`);
      if (existing.length > 0) {
        const id = existing[0]!.id;
        logger.debug(`keycloak user present: ${spec.email}`, { id });
        // GET-merge-PUT to keep required fields intact.
        const current = await adminCall<Record<string, unknown>>('GET', `/users/${id}`);
        const merged = {
          ...current,
          firstName: spec.firstName,
          lastName: spec.lastName,
          attributes: { ...(current.attributes as Record<string, string[]>), ...expandAttributes(spec.attributes) },
        };
        await adminCall('PUT', `/users/${id}`, merged);
        return { id };
      }
      await adminCall('POST', `/users`, {
        email: spec.email,
        username: spec.email,
        firstName: spec.firstName,
        lastName: spec.lastName,
        enabled: true,
        emailVerified: true,
        attributes: expandAttributes(spec.attributes),
        credentials: [{ type: 'password', value: spec.password, temporary: false }],
      });
      const created = await adminCall<Array<{ id: string }>>('GET', `/users?email=${encodeURIComponent(spec.email)}&exact=true`);
      const id = created[0]!.id;
      logger.info(`keycloak user created: ${spec.email}`, { id });
      return { id };
    },

    async ensureClientCredentialsClient(spec) {
      const existing = await adminCall<Array<{ id: string; clientId: string; secret?: string }>>(
        'GET',
        `/clients?clientId=${encodeURIComponent(spec.clientId)}`
      );
      let uuid: string;
      if (existing.length > 0) {
        uuid = existing[0]!.id;
      } else {
        await adminCall('POST', `/clients`, {
          clientId: spec.clientId,
          name: spec.name,
          enabled: true,
          protocol: 'openid-connect',
          publicClient: false,
          standardFlowEnabled: false,
          directAccessGrantsEnabled: false,
          serviceAccountsEnabled: true,
          attributes: spec.serviceAccountAttributes,
        });
        const lookup = await adminCall<Array<{ id: string }>>(
          'GET',
          `/clients?clientId=${encodeURIComponent(spec.clientId)}`
        );
        uuid = lookup[0]!.id;
      }
      const secret = await adminCall<{ value: string }>('POST', `/clients/${uuid}/client-secret`);
      logger.info(`keycloak client ensured: ${spec.clientId}`);
      return { clientId: spec.clientId, clientSecret: secret.value };
    },
  };
}

function expandAttributes(attrs: Record<string, string>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(attrs)) out[k] = [v];
  return out;
}
