import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { InternalServiceGuard } from './internal-service.guard.js';
import * as configModule from '../config.js';

// InternalServiceGuard gates the /api/v1/internal/* surface. Unlike the
// SeedGuard, there is no _ENABLED toggle — the surface is permanent
// infrastructure that Domain 12 runtime enforcement depends on. The
// guard's job is to reject when (a) the token is unset by misconfig
// (defensive — Zod normally catches this at boot) or (b) the presented
// token does not match.

describe('InternalServiceGuard', () => {
  let guard: InternalServiceGuard;

  beforeEach(() => {
    guard = new InternalServiceGuard();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeContext(headerToken?: string): ExecutionContext {
    const request = {
      headers: headerToken === undefined ? {} : { 'x-internal-service-token': headerToken },
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  function mockConfig(overrides: Partial<configModule.AppConfig>): void {
    const baseline = configModule.getConfig();
    jest
      .spyOn(configModule, 'getConfig')
      .mockReturnValue({ ...baseline, ...overrides } as configModule.AppConfig);
  }

  it('rejects when AQL_INTERNAL_TOKEN is unset (defensive — Zod would normally catch this at boot)', () => {
    mockConfig({ AQL_INTERNAL_TOKEN: '' as unknown as string });
    expect(() => guard.canActivate(makeContext('any-token'))).toThrow(UnauthorizedException);
  });

  it('rejects requests carrying a wrong service token', () => {
    mockConfig({ AQL_INTERNAL_TOKEN: 'correct-token-1234567890' });
    expect(() => guard.canActivate(makeContext('wrong-token'))).toThrow(UnauthorizedException);
  });

  it('rejects requests with a missing service token header', () => {
    mockConfig({ AQL_INTERNAL_TOKEN: 'correct-token-1234567890' });
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(UnauthorizedException);
  });

  it('admits requests with a matching service token', () => {
    mockConfig({ AQL_INTERNAL_TOKEN: 'correct-token-1234567890' });
    expect(guard.canActivate(makeContext('correct-token-1234567890'))).toBe(true);
  });

  // Same length-leak defense as SeedGuard. The pad-to-longer-length plus the
  // explicit equal-length check on top of timingSafeEqual means a short
  // token and a long token both reach the same comparison path.
  it('rejects tokens of differing length without short-circuiting on length', () => {
    mockConfig({ AQL_INTERNAL_TOKEN: 'correct-token-1234567890' });
    expect(() => guard.canActivate(makeContext('short'))).toThrow(UnauthorizedException);
    expect(() =>
      guard.canActivate(
        makeContext('a-much-longer-token-than-the-configured-one-extra-padding'),
      ),
    ).toThrow(UnauthorizedException);
  });
});
