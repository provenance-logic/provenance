import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InternalConsentController } from '../internal-consent.controller.js';
import { ConsentService } from '../consent.service.js';
import { InternalServiceGuard } from '../../auth/internal-service.guard.js';
import type { ConnectionReference } from '@provenance/types';

// Controller-level tests: the guard is mocked out (it has its own spec).
// These tests cover argument validation, service wiring, and the
// 200 / 404 contract on the lookup endpoint.

const ORG_ID = 'org-1';
const AGENT_ID = 'agent-1';
const PRODUCT_ID = 'product-1';

function makeReference(overrides: Partial<ConnectionReference> = {}): ConnectionReference {
  return {
    id: 'ref-1',
    orgId: ORG_ID,
    agentId: AGENT_ID,
    productId: PRODUCT_ID,
    productVersionId: null,
    accessGrantId: 'grant-1',
    owningPrincipalId: 'owner-1',
    state: 'active',
    causedBy: 'principal_action',
    requestedAt: '2026-05-13T00:00:00.000Z',
    approvedAt: '2026-05-13T00:00:00.000Z',
    activatedAt: '2026-05-13T00:00:00.000Z',
    suspendedAt: null,
    expiresAt: '2026-06-13T00:00:00.000Z',
    terminatedAt: null,
    approvedByPrincipalId: 'owner-1',
    governancePolicyVersion: null,
    useCaseCategory: 'Reporting and Analytics',
    purposeElaboration: 'a'.repeat(60),
    intendedScope: { ports: ['discovery'] },
    dataCategoryConstraints: null,
    requestedDurationDays: 30,
    approvedScope: { ports: ['discovery'] },
    approvedDataCategoryConstraints: null,
    approvedDurationDays: 30,
    modifiedByApprover: false,
    denialReason: null,
    deniedByPrincipalId: null,
    connectionPackage: null,
    createdAt: '2026-05-13T00:00:00.000Z',
    updatedAt: '2026-05-13T00:00:00.000Z',
    ...overrides,
  };
}

describe('InternalConsentController', () => {
  let controller: InternalConsentController;
  let consentService: {
    listActiveConnectionReferencesForOrg: jest.Mock;
    findActiveConnectionReference: jest.Mock;
    notifyScopeViolation: jest.Mock;
  };

  beforeEach(async () => {
    consentService = {
      listActiveConnectionReferencesForOrg: jest.fn(),
      findActiveConnectionReference: jest.fn(),
      notifyScopeViolation: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [InternalConsentController],
      providers: [
        { provide: ConsentService, useValue: consentService },
        // The real guard reads config at request time and we don't want to
        // exercise it here — that's the guard spec's job. Always-allow
        // shim keeps the controller tests isolated.
        { provide: InternalServiceGuard, useValue: { canActivate: () => true } },
      ],
    }).compile();

    controller = moduleRef.get(InternalConsentController);
  });

  describe('GET /active (cold load)', () => {
    it('returns every active reference for the org', async () => {
      const refs = [
        makeReference({ id: 'ref-a' }),
        makeReference({ id: 'ref-b' }),
      ];
      consentService.listActiveConnectionReferencesForOrg.mockResolvedValue(refs);

      const result = await controller.listActiveForOrg(ORG_ID);

      expect(result).toEqual({ items: refs });
      expect(consentService.listActiveConnectionReferencesForOrg).toHaveBeenCalledWith(ORG_ID);
    });

    it('returns an empty items array when the org has no active references', async () => {
      consentService.listActiveConnectionReferencesForOrg.mockResolvedValue([]);
      const result = await controller.listActiveForOrg(ORG_ID);
      expect(result).toEqual({ items: [] });
    });

    it('rejects when orgId is missing', async () => {
      await expect(controller.listActiveForOrg(undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects when orgId is the empty string or whitespace', async () => {
      await expect(controller.listActiveForOrg('')).rejects.toBeInstanceOf(BadRequestException);
      await expect(controller.listActiveForOrg('   ')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('GET /active/lookup (cache-miss fallback)', () => {
    it('returns the reference when found', async () => {
      consentService.findActiveConnectionReference.mockResolvedValue(makeReference());

      const result = await controller.lookupActive(ORG_ID, AGENT_ID, PRODUCT_ID);

      expect(result.id).toBe('ref-1');
      expect(consentService.findActiveConnectionReference).toHaveBeenCalledWith(
        ORG_ID,
        AGENT_ID,
        PRODUCT_ID,
      );
    });

    it('throws NotFoundException when the service returns null', async () => {
      consentService.findActiveConnectionReference.mockResolvedValue(null);

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
    });
  });

  describe('POST /scope-violations', () => {
    const validDto = {
      referenceId: 'ref-1',
      agentId: AGENT_ID,
      productId: PRODUCT_ID,
      actionScope: { port: 'observability' },
      approvedScope: { ports: ['discovery'] },
      denyReason: 'not covered by approved scope',
      enforcementMode: 'shadow' as const,
    };

    it('returns 204 (void) and delegates to the service on a valid payload', async () => {
      await expect(controller.notifyScopeViolation(ORG_ID, validDto)).resolves.toBeUndefined();
      expect(consentService.notifyScopeViolation).toHaveBeenCalledTimes(1);
      const arg = consentService.notifyScopeViolation.mock.calls[0][0];
      expect(arg.orgId).toBe(ORG_ID);
      expect(arg.referenceId).toBe('ref-1');
      expect(arg.enforcementMode).toBe('shadow');
    });

    it('rejects when orgId is missing or blank', async () => {
      await expect(controller.notifyScopeViolation(undefined, validDto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(controller.notifyScopeViolation('  ', validDto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it.each(['referenceId', 'agentId', 'productId'] as const)(
      'rejects when %s is missing or blank',
      async (field) => {
        const bad = { ...validDto, [field]: '' };
        await expect(controller.notifyScopeViolation(ORG_ID, bad)).rejects.toBeInstanceOf(
          BadRequestException,
        );
      },
    );

    it('rejects when actionScope.port is missing', async () => {
      const bad = { ...validDto, actionScope: {} as { port: string } };
      await expect(controller.notifyScopeViolation(ORG_ID, bad)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects when approvedScope.ports is not an array', async () => {
      const bad = {
        ...validDto,
        approvedScope: { ports: 'discovery' } as unknown as { ports: string[] },
      };
      await expect(controller.notifyScopeViolation(ORG_ID, bad)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("rejects when enforcementMode is not 'shadow' or 'enforced'", async () => {
      const bad = {
        ...validDto,
        enforcementMode: 'maybe' as unknown as 'shadow' | 'enforced',
      };
      await expect(controller.notifyScopeViolation(ORG_ID, bad)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
