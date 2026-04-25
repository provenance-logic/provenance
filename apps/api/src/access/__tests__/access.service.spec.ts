import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { AccessService } from '../access.service.js';
import { AccessGrantEntity } from '../entities/access-grant.entity.js';
import { AccessRequestEntity } from '../entities/access-request.entity.js';
import { ApprovalEventEntity } from '../entities/approval-event.entity.js';
import { TEMPORAL_CLIENT } from '../temporal/temporal-client.provider.js';
import { DataProductEntity } from '../../products/entities/data-product.entity.js';
import { ConnectionPackageService } from '../connection-package.service.js';
import { ConsentService } from '../../consent/consent.service.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const mockRepo = () => ({
  createQueryBuilder: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
  }),
  findOne: jest.fn(),
  find: jest.fn(),
  findAndCount: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
});

const mockTemporalClient = () => ({
  workflow: {
    start: jest.fn().mockResolvedValue(undefined),
    getHandle: jest.fn().mockReturnValue({
      signal: jest.fn().mockResolvedValue(undefined),
    }),
  },
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = new Date('2024-01-01T00:00:00Z');

const makeGrant = (overrides: Partial<AccessGrantEntity> = {}): AccessGrantEntity => ({
  id: 'grant-1',
  orgId: 'org-1',
  productId: 'product-1',
  granteePrincipalId: 'principal-2',
  grantedBy: 'principal-1',
  grantedAt: now,
  expiresAt: null,
  revokedAt: null,
  revokedBy: null,
  accessScope: null,
  approvalRequestId: null,
  connectionPackage: null,
  ...overrides,
});

const makeRequest = (overrides: Partial<AccessRequestEntity> = {}): AccessRequestEntity => ({
  id: 'request-1',
  orgId: 'org-1',
  productId: 'product-1',
  requesterPrincipalId: 'principal-2',
  justification: 'Need access for analytics',
  accessScope: null,
  status: 'pending',
  temporalWorkflowId: 'approval-request-1',
  requestedAt: now,
  resolvedAt: null,
  resolvedBy: null,
  resolutionNote: null,
  updatedAt: now,
  ...overrides,
});

const makeEvent = (overrides: Partial<ApprovalEventEntity> = {}): ApprovalEventEntity => ({
  id: 'event-1',
  orgId: 'org-1',
  requestId: 'request-1',
  action: 'submitted',
  performedBy: 'principal-2',
  note: null,
  occurredAt: now,
  ...overrides,
});

const makeProduct = (overrides: Partial<DataProductEntity> = {}): Partial<DataProductEntity> => ({
  id: 'product-1',
  orgId: 'org-1',
  status: 'published',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AccessService', () => {
  let service: AccessService;
  let grantRepo: ReturnType<typeof mockRepo>;
  let requestRepo: ReturnType<typeof mockRepo>;
  let eventRepo: ReturnType<typeof mockRepo>;
  let productRepo: ReturnType<typeof mockRepo>;
  let temporalClient: ReturnType<typeof mockTemporalClient>;
  let consentService: { cascadeRevokeForGrant: jest.Mock };

  beforeEach(async () => {
    consentService = { cascadeRevokeForGrant: jest.fn().mockResolvedValue(0) };
    const module = await Test.createTestingModule({
      providers: [
        AccessService,
        { provide: getRepositoryToken(AccessGrantEntity),   useFactory: mockRepo },
        { provide: getRepositoryToken(AccessRequestEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(ApprovalEventEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(DataProductEntity),   useFactory: mockRepo },
        { provide: TEMPORAL_CLIENT, useFactory: mockTemporalClient },
        {
          provide: ConnectionPackageService,
          useValue: { generateForProduct: jest.fn().mockResolvedValue(null) },
        },
        { provide: ConsentService, useValue: consentService },
      ],
    }).compile();

    service = module.get(AccessService);
    grantRepo   = module.get(getRepositoryToken(AccessGrantEntity));
    requestRepo = module.get(getRepositoryToken(AccessRequestEntity));
    eventRepo   = module.get(getRepositoryToken(ApprovalEventEntity));
    productRepo = module.get(getRepositoryToken(DataProductEntity));
    temporalClient = module.get(TEMPORAL_CLIENT);
  });

  // -------------------------------------------------------------------------
  // createGrant()
  // -------------------------------------------------------------------------

  describe('createGrant()', () => {
    it('creates and returns an access grant', async () => {
      const grant = makeGrant();
      grantRepo.create.mockReturnValue(grant);
      grantRepo.save.mockResolvedValue(grant);

      const result = await service.createGrant(
        'org-1',
        { productId: 'product-1', granteePrincipalId: 'principal-2' },
        'principal-1',
      );

      expect(grantRepo.save).toHaveBeenCalled();
      expect(result.productId).toBe('product-1');
    });

    it('generates and persists a connection package on the grant (F10.8)', async () => {
      const grant = makeGrant();
      grantRepo.create.mockImplementation((d: Partial<AccessGrantEntity>) => ({
        ...grant,
        ...d,
      }));
      grantRepo.save.mockImplementation((g: AccessGrantEntity) => Promise.resolve(g));
      const pkg = { packageVersion: 1, generatedAt: '2026-04-19T00:00:00Z', ports: [] };
      const cps = (service as unknown as { connectionPackageService: { generateForProduct: jest.Mock } })
        .connectionPackageService;
      cps.generateForProduct.mockResolvedValueOnce(pkg);

      const result = await service.createGrant(
        'org-1',
        { productId: 'product-1', granteePrincipalId: 'principal-2' },
        'principal-1',
      );

      expect(cps.generateForProduct).toHaveBeenCalledWith('org-1', 'product-1');
      const saved = grantRepo.save.mock.calls[0][0] as AccessGrantEntity;
      expect(saved.connectionPackage).toEqual(pkg);
      expect(result.connectionPackage).toEqual(pkg);
    });

    it('does not fail grant creation when package generation throws', async () => {
      const grant = makeGrant();
      grantRepo.create.mockReturnValue(grant);
      grantRepo.save.mockResolvedValue(grant);
      const cps = (service as unknown as { connectionPackageService: { generateForProduct: jest.Mock } })
        .connectionPackageService;
      cps.generateForProduct.mockRejectedValueOnce(new Error('decrypt failed'));

      await expect(
        service.createGrant(
          'org-1',
          { productId: 'product-1', granteePrincipalId: 'principal-2' },
          'principal-1',
        ),
      ).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // getGrant()
  // -------------------------------------------------------------------------

  describe('getGrant()', () => {
    it('throws NotFoundException when grant does not exist', async () => {
      grantRepo.findOne.mockResolvedValue(null);
      await expect(service.getGrant('org-1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('returns the grant when found', async () => {
      grantRepo.findOne.mockResolvedValue(makeGrant());
      const result = await service.getGrant('org-1', 'grant-1');
      expect(result.id).toBe('grant-1');
    });
  });

  // -------------------------------------------------------------------------
  // revokeGrant()
  // -------------------------------------------------------------------------

  describe('revokeGrant()', () => {
    it('sets revokedAt and revokedBy', async () => {
      const grant = makeGrant();
      grantRepo.findOne.mockResolvedValue(grant);
      grantRepo.save.mockImplementation((g: AccessGrantEntity) => Promise.resolve(g));

      const result = await service.revokeGrant('org-1', 'grant-1', 'principal-1');

      expect(grantRepo.save).toHaveBeenCalled();
      expect(result.revokedBy).toBe('principal-1');
      expect(result.revokedAt).not.toBeNull();
    });

    it('is idempotent — returns already-revoked grant without saving again', async () => {
      const grant = makeGrant({ revokedAt: now, revokedBy: 'principal-1' });
      grantRepo.findOne.mockResolvedValue(grant);

      await service.revokeGrant('org-1', 'grant-1', 'principal-1');

      expect(grantRepo.save).not.toHaveBeenCalled();
    });

    it('cascades to revoke all connection references tied to the grant (F12.21)', async () => {
      const grant = makeGrant();
      grantRepo.findOne.mockResolvedValue(grant);
      grantRepo.save.mockImplementation((g: AccessGrantEntity) => Promise.resolve(g));

      await service.revokeGrant('org-1', 'grant-1', 'principal-1');

      expect(consentService.cascadeRevokeForGrant).toHaveBeenCalledTimes(1);
      expect(consentService.cascadeRevokeForGrant).toHaveBeenCalledWith(
        'org-1',
        'grant-1',
        'principal-1',
      );
    });

    it('does not cascade when the grant is already revoked (idempotency preserved)', async () => {
      const grant = makeGrant({ revokedAt: now, revokedBy: 'principal-1' });
      grantRepo.findOne.mockResolvedValue(grant);

      await service.revokeGrant('org-1', 'grant-1', 'principal-1');

      expect(consentService.cascadeRevokeForGrant).not.toHaveBeenCalled();
    });

    it('propagates cascade errors so the caller sees the failure', async () => {
      const grant = makeGrant();
      grantRepo.findOne.mockResolvedValue(grant);
      grantRepo.save.mockImplementation((g: AccessGrantEntity) => Promise.resolve(g));
      consentService.cascadeRevokeForGrant.mockRejectedValueOnce(new Error('cascade db error'));

      await expect(
        service.revokeGrant('org-1', 'grant-1', 'principal-1'),
      ).rejects.toThrow('cascade db error');
    });
  });

  // -------------------------------------------------------------------------
  // refreshPackagesForProduct() — F10.10
  // -------------------------------------------------------------------------

  describe('refreshPackagesForProduct()', () => {
    const freshPackage = {
      packageVersion: 1,
      generatedAt: '2024-02-01T00:00:00.000Z',
      ports: [{ portId: 'p-1', portName: 'Test', interfaceType: 'sql_jdbc', artifacts: {} }],
    };

    it('returns refreshed: 0 when no active grants exist', async () => {
      grantRepo.find.mockResolvedValue([]);
      const result = await service.refreshPackagesForProduct('org-1', 'product-1');
      expect(result).toEqual({ refreshed: 0 });
      const cps = (service as unknown as { connectionPackageService: { generateForProduct: jest.Mock } }).connectionPackageService;
      expect(cps.generateForProduct).not.toHaveBeenCalled();
    });

    it('returns refreshed: 0 when generateForProduct returns null', async () => {
      grantRepo.find.mockResolvedValue([makeGrant()]);
      const cps = (service as unknown as { connectionPackageService: { generateForProduct: jest.Mock } }).connectionPackageService;
      cps.generateForProduct.mockResolvedValueOnce(null);
      const result = await service.refreshPackagesForProduct('org-1', 'product-1');
      expect(result).toEqual({ refreshed: 0 });
      expect(grantRepo.save).not.toHaveBeenCalled();
    });

    it('skips grants whose expires_at is in the past', async () => {
      grantRepo.find.mockResolvedValue([makeGrant({ id: 'expired', expiresAt: new Date('2020-01-01') })]);
      const cps = (service as unknown as { connectionPackageService: { generateForProduct: jest.Mock } }).connectionPackageService;
      cps.generateForProduct.mockResolvedValueOnce(freshPackage);
      const result = await service.refreshPackagesForProduct('org-1', 'product-1');
      expect(result).toEqual({ refreshed: 0 });
      expect(cps.generateForProduct).not.toHaveBeenCalled();
    });

    it('rewrites the package and bumps packageVersion for each active grant', async () => {
      const g1 = makeGrant({ id: 'g1', connectionPackage: { packageVersion: 3 } as Record<string, unknown> });
      const g2 = makeGrant({ id: 'g2', connectionPackage: null });
      grantRepo.find.mockResolvedValue([g1, g2]);
      const cps = (service as unknown as { connectionPackageService: { generateForProduct: jest.Mock } }).connectionPackageService;
      cps.generateForProduct.mockResolvedValueOnce(freshPackage);
      grantRepo.save.mockImplementation((g: AccessGrantEntity) => Promise.resolve(g));

      const result = await service.refreshPackagesForProduct('org-1', 'product-1');

      expect(result).toEqual({ refreshed: 2 });
      expect(cps.generateForProduct).toHaveBeenCalledTimes(1);
      expect(grantRepo.save).toHaveBeenCalledTimes(2);
      expect((g1.connectionPackage as { packageVersion: number }).packageVersion).toBe(4);
      expect((g2.connectionPackage as { packageVersion: number }).packageVersion).toBe(1);
      expect((g1.connectionPackage as { ports: unknown[] }).ports).toEqual(freshPackage.ports);
    });
  });

  // -------------------------------------------------------------------------
  // submitRequest()
  // -------------------------------------------------------------------------

  describe('submitRequest()', () => {
    it('throws ConflictException when a pending request already exists', async () => {
      grantRepo.findOne.mockResolvedValue(null);
      productRepo.findOne.mockResolvedValue(makeProduct());
      requestRepo.findOne.mockResolvedValue(makeRequest());

      await expect(
        service.submitRequest('org-1', { productId: 'product-1' }, 'principal-2'),
      ).rejects.toThrow(ConflictException);
    });

    it('creates the request and records a submitted event', async () => {
      grantRepo.findOne.mockResolvedValue(null);
      productRepo.findOne.mockResolvedValue(makeProduct());
      requestRepo.findOne.mockResolvedValue(null); // no duplicate
      const request = makeRequest();
      requestRepo.create.mockReturnValue(request);
      requestRepo.save.mockResolvedValue(request);
      eventRepo.create.mockImplementation((d: any) => d);
      eventRepo.save.mockResolvedValue(makeEvent());

      const result = await service.submitRequest(
        'org-1',
        { productId: 'product-1', justification: 'analytics' },
        'principal-2',
      );

      expect(requestRepo.save).toHaveBeenCalled();
      expect(eventRepo.save).toHaveBeenCalled();
      expect(result.status).toBe('pending');
    });

    it('starts a Temporal workflow and stores the workflow ID', async () => {
      grantRepo.findOne.mockResolvedValue(null);
      productRepo.findOne.mockResolvedValue(makeProduct());
      requestRepo.findOne.mockResolvedValue(null);
      const request = makeRequest({ temporalWorkflowId: null });
      requestRepo.create.mockReturnValue(request);
      requestRepo.save.mockResolvedValue(request);
      eventRepo.create.mockImplementation((d: any) => d);
      eventRepo.save.mockResolvedValue(makeEvent());

      await service.submitRequest('org-1', { productId: 'product-1' }, 'principal-2');

      expect(temporalClient.workflow.start).toHaveBeenCalledTimes(1);
    });

    it('still returns a request if Temporal workflow start fails', async () => {
      grantRepo.findOne.mockResolvedValue(null);
      productRepo.findOne.mockResolvedValue(makeProduct());
      requestRepo.findOne.mockResolvedValue(null);
      const request = makeRequest();
      requestRepo.create.mockReturnValue(request);
      requestRepo.save.mockResolvedValue(request);
      eventRepo.create.mockImplementation((d: any) => d);
      eventRepo.save.mockResolvedValue(makeEvent());
      temporalClient.workflow.start.mockRejectedValueOnce(new Error('Temporal unavailable'));

      const result = await service.submitRequest('org-1', { productId: 'product-1' }, 'p-2');

      expect(result.status).toBe('pending');
    });
  });

  // -------------------------------------------------------------------------
  // approveRequest()
  // -------------------------------------------------------------------------

  describe('approveRequest()', () => {
    it('throws NotFoundException when request does not exist', async () => {
      requestRepo.findOne.mockResolvedValue(null);
      await expect(
        service.approveRequest('org-1', 'missing', {}, 'principal-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when request is not pending', async () => {
      requestRepo.findOne.mockResolvedValue(makeRequest({ status: 'denied' }));
      await expect(
        service.approveRequest('org-1', 'request-1', {}, 'principal-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('transitions request to approved, creates grant, and records approved event', async () => {
      const request = makeRequest();
      requestRepo.findOne.mockResolvedValue(request);
      requestRepo.save.mockImplementation((r: any) => Promise.resolve(r));
      const grant = makeGrant({ approvalRequestId: 'request-1' });
      grantRepo.create.mockReturnValue(grant);
      grantRepo.save.mockResolvedValue(grant);
      eventRepo.create.mockImplementation((d: any) => d);
      eventRepo.save.mockResolvedValue(makeEvent({ action: 'approved' }));

      const result = await service.approveRequest('org-1', 'request-1', { note: 'OK' }, 'principal-1');

      expect(requestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'approved' }),
      );
      expect(grantRepo.save).toHaveBeenCalled();
      expect(result.grant.approvalRequestId).toBe('request-1');
      expect(result.request.status).toBe('approved');
    });

    it('signals the Temporal workflow after approval', async () => {
      const request = makeRequest();
      requestRepo.findOne.mockResolvedValue(request);
      requestRepo.save.mockImplementation((r: any) => Promise.resolve(r));
      grantRepo.create.mockReturnValue(makeGrant());
      grantRepo.save.mockResolvedValue(makeGrant());
      eventRepo.create.mockImplementation((d: any) => d);
      eventRepo.save.mockResolvedValue(makeEvent());

      await service.approveRequest('org-1', 'request-1', {}, 'principal-1');

      expect(temporalClient.workflow.getHandle).toHaveBeenCalledWith('approval-request-1');
    });
  });

  // -------------------------------------------------------------------------
  // denyRequest()
  // -------------------------------------------------------------------------

  describe('denyRequest()', () => {
    it('transitions request to denied and records denied event', async () => {
      const request = makeRequest();
      requestRepo.findOne.mockResolvedValue(request);
      requestRepo.save.mockImplementation((r: any) => Promise.resolve(r));
      eventRepo.create.mockImplementation((d: any) => d);
      eventRepo.save.mockResolvedValue(makeEvent({ action: 'denied' }));

      const result = await service.denyRequest('org-1', 'request-1', { note: 'Policy violation' }, 'principal-1');

      expect(result.status).toBe('denied');
      expect(result.resolvedBy).toBe('principal-1');
    });

    it('throws ConflictException when request is not pending', async () => {
      requestRepo.findOne.mockResolvedValue(makeRequest({ status: 'approved' }));
      await expect(
        service.denyRequest('org-1', 'request-1', {}, 'principal-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  // -------------------------------------------------------------------------
  // withdrawRequest()
  // -------------------------------------------------------------------------

  describe('withdrawRequest()', () => {
    it('throws ForbiddenException when caller is not the original requester', async () => {
      requestRepo.findOne.mockResolvedValue(makeRequest({ requesterPrincipalId: 'principal-2' }));

      await expect(
        service.withdrawRequest('org-1', 'request-1', {}, 'different-principal'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('transitions request to withdrawn when called by the requester', async () => {
      const request = makeRequest({ requesterPrincipalId: 'principal-2' });
      requestRepo.findOne.mockResolvedValue(request);
      requestRepo.save.mockImplementation((r: any) => Promise.resolve(r));
      eventRepo.create.mockImplementation((d: any) => d);
      eventRepo.save.mockResolvedValue(makeEvent({ action: 'withdrawn' }));

      const result = await service.withdrawRequest('org-1', 'request-1', {}, 'principal-2');

      expect(result.status).toBe('withdrawn');
    });

    it('throws ConflictException when request is not pending', async () => {
      requestRepo.findOne.mockResolvedValue(makeRequest({ status: 'approved', requesterPrincipalId: 'p-2' }));
      await expect(
        service.withdrawRequest('org-1', 'request-1', {}, 'p-2'),
      ).rejects.toThrow(ConflictException);
    });
  });

  // -------------------------------------------------------------------------
  // listApprovalEvents()
  // -------------------------------------------------------------------------

  describe('listApprovalEvents()', () => {
    it('throws NotFoundException when the request does not exist', async () => {
      requestRepo.findOne.mockResolvedValue(null);
      await expect(
        service.listApprovalEvents('org-1', 'missing', { limit: 20, offset: 0 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns paginated events for the request', async () => {
      requestRepo.findOne.mockResolvedValue(makeRequest());
      eventRepo.findAndCount.mockResolvedValue([[makeEvent()], 1]);

      const result = await service.listApprovalEvents('org-1', 'request-1', { limit: 20, offset: 0 });

      expect(result.meta.total).toBe(1);
      expect(result.items[0].action).toBe('submitted');
    });
  });
});
