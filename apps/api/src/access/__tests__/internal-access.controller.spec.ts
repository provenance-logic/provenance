import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InternalAccessController } from '../internal-access.controller.js';
import { AccessService } from '../access.service.js';
import { InternalServiceGuard } from '../../auth/internal-service.guard.js';
import type { AccessGrant } from '@provenance/types';

// Controller-level tests: the guard is mocked out (it has its own spec).
// These tests cover argument validation, service wiring, and the
// 200 / 404 contract on the lookup endpoint.

const ORG_ID = 'org-1';
const AGENT_ID = 'agent-1';
const PRODUCT_ID = 'product-1';

function makeGrant(overrides: Partial<AccessGrant> = {}): AccessGrant {
  return {
    id: 'grant-1',
    orgId: ORG_ID,
    productId: PRODUCT_ID,
    granteePrincipalId: AGENT_ID,
    grantedBy: 'owner-1',
    grantedAt: '2026-05-13T00:00:00.000Z',
    expiresAt: null,
    revokedAt: null,
    revokedBy: null,
    accessScope: null,
    approvalRequestId: null,
    connectionPackage: null,
    ...overrides,
  };
}

describe('InternalAccessController', () => {
  let controller: InternalAccessController;
  let accessService: { findActiveGrant: jest.Mock };

  beforeEach(async () => {
    accessService = { findActiveGrant: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [InternalAccessController],
      providers: [
        { provide: AccessService, useValue: accessService },
        // Always-allow shim — the guard has its own spec.
        { provide: InternalServiceGuard, useValue: { canActivate: () => true } },
      ],
    }).compile();

    controller = moduleRef.get(InternalAccessController);
  });

  describe('GET /active/lookup', () => {
    it('returns the grant when found', async () => {
      accessService.findActiveGrant.mockResolvedValue(makeGrant());

      const result = await controller.lookupActive(ORG_ID, AGENT_ID, PRODUCT_ID);

      expect(result.id).toBe('grant-1');
      expect(accessService.findActiveGrant).toHaveBeenCalledWith(
        ORG_ID,
        AGENT_ID,
        PRODUCT_ID,
      );
    });

    it('throws NotFoundException when the service returns null', async () => {
      accessService.findActiveGrant.mockResolvedValue(null);

      await expect(
        controller.lookupActive(ORG_ID, AGENT_ID, PRODUCT_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects when any required query param is missing', async () => {
      await expect(
        controller.lookupActive(undefined, AGENT_ID, PRODUCT_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        controller.lookupActive(ORG_ID, undefined, PRODUCT_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        controller.lookupActive(ORG_ID, AGENT_ID, undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when any required query param is empty or whitespace', async () => {
      await expect(controller.lookupActive('', AGENT_ID, PRODUCT_ID)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(controller.lookupActive(ORG_ID, '  ', PRODUCT_ID)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(controller.lookupActive(ORG_ID, AGENT_ID, '   ')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
