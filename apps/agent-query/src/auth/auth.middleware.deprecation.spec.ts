/**
 * Tests for DEPRECATION_WARNING_ONLY=true mode (Phase 5c-9/11).
 *
 * Separate file because config is cached at module load time and this
 * mode requires a different env var state than the main test file.
 */

import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { IncomingMessage, ServerResponse } from 'node:http';

const { privateKey: rawPrivate, publicKey: rawPublic } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

jest.mock('jwks-rsa', () => {
  const factory = jest.fn(() => ({
    getSigningKey: jest.fn(
      (_kid: string, cb: (err: Error | null, key?: { getPublicKey: () => string }) => void) => {
        cb(null, { getPublicKey: () => rawPublic });
      },
    ),
  }));
  return { __esModule: true, default: factory, JwksClient: factory };
});

// Set DEPRECATION_WARNING_ONLY=true BEFORE config loads
process.env['PORT'] = '3002';
process.env['CONTROL_PLANE_URL'] = 'http://localhost:3001';
process.env['MCP_API_KEY'] = 'test-mcp-key';
process.env['DEFAULT_ORG_ID'] = '00000000-0000-0000-0000-000000000001';
process.env['KEYCLOAK_URL'] = 'http://localhost:8080';
process.env['KEYCLOAK_REALM'] = 'provenance';
process.env['DEPRECATION_WARNING_ONLY'] = 'true';

import { createAgentAuthMiddleware } from './auth.middleware.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockReq(headers: Record<string, string> = {}, remoteAddress = '127.0.0.1'): IncomingMessage {
  return { headers, socket: { remoteAddress } } as unknown as IncomingMessage;
}

function mockRes(): any {
  return {
    statusCode: 200,
    ended: false,
    writeHead: jest.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
    end: jest.fn(function (this: any) { this.ended = true; }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Agent Auth Middleware — DEPRECATION_WARNING_ONLY=true (Phase 5c-9)', () => {
  let middleware: ReturnType<typeof createAgentAuthMiddleware>;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    middleware = createAgentAuthMiddleware();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('logs deprecation warning and calls next() for unauthenticated requests', async () => {
    const req = mockReq({}, '10.0.0.99');
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    // Warning logged
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain('[AUTH]');
    expect(msg).toContain('10.0.0.99');

    // Request allowed through — next() called, no 401
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.writeHead).not.toHaveBeenCalled();
  });

  it('does not set agentId or orgId on the request in deprecation mode', async () => {
    const req = mockReq({});
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect((req as any).agentId).toBeUndefined();
    expect((req as any).orgId).toBeUndefined();
  });

  it('still validates and attaches identity for properly authenticated requests', async () => {
    const AGENT_ID = '550e8400-e29b-41d4-a716-446655440000';
    const ORG_ID = '660e8400-e29b-41d4-a716-446655440001';

    const token = jwt.sign(
      {
        sub: AGENT_ID,
        agent_id: AGENT_ID,
        provenance_org_id: ORG_ID,
        provenance_principal_type: 'ai_agent',
      },
      rawPrivate,
      {
        algorithm: 'RS256',
        keyid: 'test-kid',
        expiresIn: '5m',
        issuer: 'http://localhost:8080/realms/provenance',
      },
    );

    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    // No deprecation warning — request is properly authenticated
    expect(warnSpy).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect((req as any).agentId).toBe(AGENT_ID);
    expect((req as any).orgId).toBe(ORG_ID);
  });
});
