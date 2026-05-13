import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from 'crypto';
import { getConfig } from '../config.js';

// Gates the /api/v1/internal/* controller surface — endpoints the Agent
// Query Layer (and any future internal worker) call to read or mutate
// platform state without a user-bound JWT. Two design choices worth
// flagging:
//
//   1. Constant-time comparison. timingSafeEqual on equal-length buffers,
//      with both inputs padded to the longer length first so a
//      length-difference does not short-circuit. Same defense the
//      SeedGuard uses.
//
//   2. No feature-flag gate. Unlike SEED_ENABLED, the internal surface
//      is permanent infrastructure — Domain 12 runtime enforcement
//      cannot function without it. The guard rejects when the token
//      is unset (which can only happen if config validation was
//      bypassed; the Zod schema marks AQL_INTERNAL_TOKEN as required).
//
// Use with @Public() so JwtAuthGuard does not also run — internal
// callers do not carry a user JWT.
@Injectable()
export class InternalServiceGuard implements CanActivate {
  private readonly logger = new Logger(InternalServiceGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const config = getConfig();

    if (!config.AQL_INTERNAL_TOKEN || config.AQL_INTERNAL_TOKEN.length === 0) {
      // Should not reach here in practice — Zod marks the field required.
      // The defensive check protects against a future refactor that makes
      // the field optional without updating this guard.
      this.logger.error(
        'AQL_INTERNAL_TOKEN is unset — refusing all requests to /api/v1/internal/*',
      );
      throw new UnauthorizedException('Internal service surface is misconfigured');
    }

    const req = context.switchToHttp().getRequest<Request>();
    const presented = (req.headers['x-internal-service-token'] ?? '') as string;

    if (!constantTimeMatches(presented, config.AQL_INTERNAL_TOKEN)) {
      throw new UnauthorizedException('Invalid internal service token');
    }

    return true;
  }
}

function constantTimeMatches(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf-8');
  const bBuf = Buffer.from(b, 'utf-8');
  const len = Math.max(aBuf.length, bBuf.length);
  const aPadded = Buffer.alloc(len);
  const bPadded = Buffer.alloc(len);
  aBuf.copy(aPadded);
  bBuf.copy(bPadded);
  return aBuf.length === bBuf.length && timingSafeEqual(aPadded, bPadded);
}
