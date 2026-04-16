import type { IncomingMessage, ServerResponse } from 'node:http';
import jwt from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import { getConfig } from '../config.js';

interface AgentClaims {
  agent_id: string;
  provenance_org_id: string;
  provenance_principal_type: string;
  [key: string]: unknown;
}

/**
 * Creates Express middleware that validates agent JWT Bearer tokens against
 * Keycloak's JWKS endpoint.
 *
 * On success, attaches `agentId` and `orgId` to the request object.
 * On any failure, responds with 401 (no body).
 */
export function createAgentAuthMiddleware() {
  const config = getConfig();
  const expectedIssuer = `${config.KEYCLOAK_URL}/realms/${config.KEYCLOAK_REALM}`;

  const client = new JwksClient({
    jwksUri: `${expectedIssuer}/protocol/openid-connect/certs`,
    cache: true,
    cacheMaxAge: 3_600_000, // 1 hour
    rateLimit: true,
    jwksRequestsPerMinute: 10,
  });

  function getKey(
    header: jwt.JwtHeader,
    callback: (err: Error | null, key?: string) => void,
  ): void {
    client.getSigningKey(header.kid ?? '', (err, signingKey) => {
      if (err || !signingKey) {
        callback(err ?? new Error('Signing key not found'));
        return;
      }
      callback(null, signingKey.getPublicKey());
    });
  }

  const deprecationMode = config.DEPRECATION_WARNING_ONLY;

  return async function agentAuthMiddleware(
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ): Promise<void> {
    const reject = () => {
      res.writeHead(401);
      res.end();
    };

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      const ip = (req.socket?.remoteAddress) ?? 'unknown';
      console.warn(
        `[AUTH] Unauthenticated MCP request from ${ip} — this will be rejected after the deprecation period`,
      );

      if (deprecationMode) {
        next();
      } else {
        reject();
      }
      return;
    }

    const token = authHeader.slice(7);

    try {
      const decoded = await new Promise<AgentClaims>((resolve, rejectP) => {
        jwt.verify(
          token,
          getKey,
          {
            algorithms: ['RS256'],
            issuer: expectedIssuer,
          },
          (err, payload) => {
            if (err) return rejectP(err);
            resolve(payload as AgentClaims);
          },
        );
      });

      if (decoded.provenance_principal_type !== 'ai_agent') {
        reject();
        return;
      }

      if (!decoded.agent_id || !decoded.provenance_org_id) {
        reject();
        return;
      }

      (req as any).agentId = decoded.agent_id;
      (req as any).orgId = decoded.provenance_org_id;

      next();
    } catch {
      reject();
    }
  };
}
