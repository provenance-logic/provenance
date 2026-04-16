import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { IncomingMessage, ServerResponse } from 'node:http';

// ---------------------------------------------------------------------------
// Generate a throwaway RSA key pair for test signing
// ---------------------------------------------------------------------------

const { privateKey: rawPrivate, publicKey: rawPublic } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const privateKey = rawPrivate;
const publicKeyObj = createPublicKey(rawPublic);
const jwk = publicKeyObj.export({ format: 'jwk' });

// ---------------------------------------------------------------------------
// Mock jwks-rsa before importing the module under test.
// The mock returns our test public key for any kid.
// ---------------------------------------------------------------------------

jest.mock('jwks-rsa', () => {
  const factory = jest.fn(() => {
    const client: any = {};
    client.getSigningKey = jest.fn(
      (_kid: string, cb: (err: Error | null, key?: { getPublicKey: () => string }) => void) => {
        cb(null, { getPublicKey: () => rawPublic });
      },
    );
    return client;
  });
  return {
    __esModule: true,
    default: factory,
    JwksClient: factory,
  };
});

// Set env before importing config
process.env['PORT'] = '3002';
process.env['CONTROL_PLANE_URL'] = 'http://localhost:3001';
process.env['MCP_API_KEY'] = 'test-mcp-key';
process.env['DEFAULT_ORG_ID'] = '00000000-0000-0000-0000-000000000001';
process.env['KEYCLOAK_URL'] = 'http://localhost:8080';
process.env['KEYCLOAK_REALM'] = 'provenance';

import { createAgentAuthMiddleware } from './auth.middleware.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AGENT_ID = '550e8400-e29b-41d4-a716-446655440000';
const ORG_ID = '660e8400-e29b-41d4-a716-446655440001';

function signToken(claims: Record<string, unknown>, options: jwt.SignOptions = {}): string {
  return jwt.sign(claims, privateKey, {
    algorithm: 'RS256',
    keyid: 'test-kid',
    expiresIn: '5m',
    issuer: 'http://localhost:8080/realms/provenance',
    ...options,
  });
}

function mockReq(headers: Record<string, string> = {}, remoteAddress = '127.0.0.1'): IncomingMessage {
  return { headers, socket: { remoteAddress } } as unknown as IncomingMessage;
}

function mockRes(): ServerResponse & { statusCode: number; ended: boolean } {
  const res: any = {
    statusCode: 200,
    ended: false,
    writeHead: jest.fn(function (this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    end: jest.fn(function (this: any) {
      this.ended = true;
    }),
  };
  return res;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Capture console.warn for structured warning assertions
let warnSpy: jest.SpyInstance;

describe('Agent Auth Middleware', () => {
  let middleware: ReturnType<typeof createAgentAuthMiddleware>;

  beforeEach(() => {
    middleware = createAgentAuthMiddleware();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('attaches agentId and orgId to the request for a valid agent JWT', async () => {
    const token = signToken({
      sub: AGENT_ID,
      agent_id: AGENT_ID,
      provenance_org_id: ORG_ID,
      provenance_principal_type: 'ai_agent',
    });

    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((req as any).agentId).toBe(AGENT_ID);
    expect((req as any).orgId).toBe(ORG_ID);
  });

  // -------------------------------------------------------------------------
  // Missing Authorization header
  // -------------------------------------------------------------------------

  it('returns 401 when Authorization header is missing', async () => {
    const req = mockReq({});
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.writeHead).toHaveBeenCalledWith(401);
    expect(res.ended).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Malformed Authorization header
  // -------------------------------------------------------------------------

  it('returns 401 when Authorization header is not Bearer scheme', async () => {
    const req = mockReq({ authorization: 'Basic abc123' });
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.writeHead).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Expired token
  // -------------------------------------------------------------------------

  it('returns 401 for an expired token', async () => {
    const token = signToken(
      {
        sub: AGENT_ID,
        agent_id: AGENT_ID,
        provenance_org_id: ORG_ID,
        provenance_principal_type: 'ai_agent',
      },
      { expiresIn: '0s' },
    );

    // Wait briefly to ensure expiry
    await new Promise((r) => setTimeout(r, 50));

    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.writeHead).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Wrong principal type
  // -------------------------------------------------------------------------

  it('returns 401 when provenance_principal_type is not ai_agent', async () => {
    const token = signToken({
      sub: AGENT_ID,
      agent_id: AGENT_ID,
      provenance_org_id: ORG_ID,
      provenance_principal_type: 'human_user',
    });

    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.writeHead).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Missing agent_id claim
  // -------------------------------------------------------------------------

  it('returns 401 when agent_id claim is missing', async () => {
    const token = signToken({
      sub: AGENT_ID,
      provenance_org_id: ORG_ID,
      provenance_principal_type: 'ai_agent',
    });

    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.writeHead).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Missing provenance_org_id claim
  // -------------------------------------------------------------------------

  it('returns 401 when provenance_org_id claim is missing', async () => {
    const token = signToken({
      sub: AGENT_ID,
      agent_id: AGENT_ID,
      provenance_principal_type: 'ai_agent',
    });

    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.writeHead).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Wrong issuer
  // -------------------------------------------------------------------------

  it('returns 401 when issuer does not match', async () => {
    const token = signToken(
      {
        sub: AGENT_ID,
        agent_id: AGENT_ID,
        provenance_org_id: ORG_ID,
        provenance_principal_type: 'ai_agent',
      },
      { issuer: 'http://evil.example.com/realms/provenance' },
    );

    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.writeHead).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Completely invalid token string
  // -------------------------------------------------------------------------

  it('returns 401 for a garbage token', async () => {
    const req = mockReq({ authorization: 'Bearer not.a.jwt' });
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.writeHead).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // No response body on rejection
  // -------------------------------------------------------------------------

  it('sends no body on 401 rejection', async () => {
    const req = mockReq({});
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.writeHead).toHaveBeenCalledWith(401);
    // end() called with no arguments — no body
    expect(res.end).toHaveBeenCalledWith();
  });

  // -------------------------------------------------------------------------
  // Deprecation warning on unauthenticated requests (Phase 5c-9)
  // -------------------------------------------------------------------------

  it('logs a structured deprecation warning when Authorization header is missing', async () => {
    const req = mockReq({}, '10.0.0.42');
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain('[AUTH]');
    expect(msg).toContain('Unauthenticated MCP request');
    expect(msg).toContain('10.0.0.42');
    expect(msg).toContain('rejected after the deprecation period');
  });

  it('logs deprecation warning for non-Bearer auth scheme', async () => {
    const req = mockReq({ authorization: 'Basic abc123' }, '192.168.1.1');
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain('192.168.1.1');
  });

  it('does NOT log deprecation warning for valid tokens', async () => {
    const token = signToken({
      sub: AGENT_ID,
      agent_id: AGENT_ID,
      provenance_org_id: ORG_ID,
      provenance_principal_type: 'ai_agent',
    });

    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does NOT log deprecation warning for invalid tokens (they have a Bearer header)', async () => {
    const req = mockReq({ authorization: 'Bearer expired.or.bad.jwt' });
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    // Invalid tokens are rejected but they did provide a Bearer token,
    // so no deprecation warning — this is an auth failure, not a missing-auth situation
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('still rejects with 401 after logging the deprecation warning (default mode)', async () => {
    const req = mockReq({});
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(res.writeHead).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
