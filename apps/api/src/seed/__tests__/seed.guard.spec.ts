import { ExecutionContext, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { SeedGuard } from '../seed.guard.js';
import * as configModule from '../../config.js';

// SeedGuard is the only access control on the /api/v1/seed/* surface, so its
// behavior matters: the surface must be invisible (404) when SEED_ENABLED is
// false, must reject when no SEED_API_KEY is configured even with the flag
// on, and must reject when the presented token does not match.

describe('SeedGuard', () => {
  let guard: SeedGuard;

  beforeEach(() => {
    guard = new SeedGuard();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeContext(headerToken?: string): ExecutionContext {
    const request = {
      headers: headerToken === undefined ? {} : { 'x-seed-service-token': headerToken },
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

  it('returns 404 when SEED_ENABLED is false', () => {
    mockConfig({ SEED_ENABLED: false, SEED_API_KEY: 'whatever' });
    expect(() => guard.canActivate(makeContext('whatever'))).toThrow(NotFoundException);
  });

  it('rejects when SEED_ENABLED is true but SEED_API_KEY is unset', () => {
    mockConfig({ SEED_ENABLED: true, SEED_API_KEY: undefined });
    expect(() => guard.canActivate(makeContext('whatever'))).toThrow(UnauthorizedException);
  });

  it('rejects requests with a wrong service token', () => {
    mockConfig({ SEED_ENABLED: true, SEED_API_KEY: 'correct-token' });
    expect(() => guard.canActivate(makeContext('wrong-token'))).toThrow(UnauthorizedException);
  });

  it('rejects requests with a missing service token header', () => {
    mockConfig({ SEED_ENABLED: true, SEED_API_KEY: 'correct-token' });
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(UnauthorizedException);
  });

  it('admits requests with a matching service token', () => {
    mockConfig({ SEED_ENABLED: true, SEED_API_KEY: 'correct-token' });
    expect(guard.canActivate(makeContext('correct-token'))).toBe(true);
  });

  // Defends against length-only timing leaks. The check pads to the longer
  // length AND verifies equal length — neither value's length should leak
  // through the comparison.
  it('rejects tokens of differing length without short-circuiting on length', () => {
    mockConfig({ SEED_ENABLED: true, SEED_API_KEY: 'correct-token' });
    expect(() => guard.canActivate(makeContext('short'))).toThrow(UnauthorizedException);
    expect(() =>
      guard.canActivate(makeContext('a-much-longer-token-than-expected')),
    ).toThrow(UnauthorizedException);
  });
});
