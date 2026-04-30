import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from 'crypto';
import { getConfig } from '../config.js';

// Gates the /api/v1/seed/* surface. Two checks:
//
// 1. SEED_ENABLED must be true. When false, every request to a seed endpoint
//    is treated as a 404 — the surface is invisible. Production must never
//    set SEED_ENABLED=true.
// 2. The `x-seed-service-token` header must match SEED_API_KEY exactly,
//    compared in constant time. Missing or empty SEED_API_KEY rejects all
//    requests even when SEED_ENABLED=true.
//
// Endpoints decorated with @Public() bypass JwtAuthGuard, so this guard is
// the only access control on the seed surface.
@Injectable()
export class SeedGuard implements CanActivate {
  private readonly logger = new Logger(SeedGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const config = getConfig();

    if (!config.SEED_ENABLED) {
      // Treat as 404 so a misconfigured production stack does not advertise
      // the seed surface to attackers probing for it.
      throw new NotFoundException();
    }

    if (!config.SEED_API_KEY || config.SEED_API_KEY.length === 0) {
      this.logger.error(
        'SEED_ENABLED=true but SEED_API_KEY is unset — refusing all requests to /api/v1/seed/*',
      );
      throw new UnauthorizedException('Seed surface is enabled but no API key is configured');
    }

    const req = context.switchToHttp().getRequest<Request>();
    const presented = (req.headers['x-seed-service-token'] ?? '') as string;

    if (!constantTimeMatches(presented, config.SEED_API_KEY)) {
      throw new UnauthorizedException('Invalid seed service token');
    }

    return true;
  }
}

function constantTimeMatches(a: string, b: string): boolean {
  // timingSafeEqual requires equal-length buffers; pad to the longer length
  // first so a length difference cannot short-circuit the comparison.
  const aBuf = Buffer.from(a, 'utf-8');
  const bBuf = Buffer.from(b, 'utf-8');
  const len = Math.max(aBuf.length, bBuf.length);
  const aPadded = Buffer.alloc(len);
  const bPadded = Buffer.alloc(len);
  aBuf.copy(aPadded);
  bBuf.copy(bPadded);
  return aBuf.length === bBuf.length && timingSafeEqual(aPadded, bPadded);
}
