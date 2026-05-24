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
import { PortDeclarationEntity } from '../../products/entities/port-declaration.entity.js';
import { ConnectionPackageService } from '../connection-package.service.js';
import { ConsentService } from '../../consent/consent.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';

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
  // approve/deny scope-violation audit row goes through repo.manager.query.
  manager: { query: jest.fn().mockResolvedValue(undefined) },
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
  expiryWarningSentAt: null,
  expiryWarning7dSentAt: null,
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
  slaWarningSentAt: null,
  slaBreachNotifiedAt: null,
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
  name: 'Customer Events',
  ownerPrincipalId: 'owner-1',
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
  let notificationsService: { enqueue: jest.Mock };

  beforeEach(async () => {
    consentService = { cascadeRevokeForGrant: jest.fn().mockResolvedValue(0) };
    notificationsService = { enqueue: jest.fn().mockResolvedValue([]) };
    const module = await Test.createTestingModule({
      providers: [
        AccessService,
        { provide: getRepositoryToken(AccessGrantEntity),   useFactory: mockRepo },
        { provide: getRepositoryToken(AccessRequestEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(ApprovalEventEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(DataProductEntity),   useFactory: mockRepo },
        { provide: getRepositoryToken(PortDeclarationEntity), useFactory: mockRepo },
        { provide: TEMPORAL_CLIENT, useFactory: mockTemporalClient },
        {
          provide: ConnectionPackageService,
          useValue: { generateForProduct: jest.fn().mockResolvedValue(null) },
        },
        { provide: ConsentService, useValue: consentService },
        { provide: NotificationsService, useValue: notificationsService },
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
  // findActiveGrant() — Domain 12 PR #5a internal cache-miss fallback
  // -------------------------------------------------------------------------

  describe('findActiveGrant()', () => {
    it('returns the grant when an active (non-revoked, non-expired) row exists', async () => {
      grantRepo.findOne.mockResolvedValue(makeGrant());
      const result = await service.findActiveGrant('org-1', 'principal-2', 'product-1');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('grant-1');
    });

    it('filters the repo query to non-revoked rows so a revoked grant looks absent at the boundary', async () => {
      grantRepo.findOne.mockResolvedValue(null);
      await service.findActiveGrant('org-1', 'principal-2', 'product-1');
      const where = grantRepo.findOne.mock.calls[0][0].where;
      expect(where.revokedAt).toBeDefined();
      expect(where.orgId).toBe('org-1');
      expect(where.granteePrincipalId).toBe('principal-2');
      expect(where.productId).toBe('product-1');
    });

    it('returns null when the repo returns no row', async () => {
      grantRepo.findOne.mockResolvedValue(null);
      const result = await service.findActiveGrant('org-1', 'principal-2', 'product-1');
      expect(result).toBeNull();
    });

    it('returns null when the row has an expiresAt in the past', async () => {
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
      grantRepo.findOne.mockResolvedValue(makeGrant({ expiresAt: past }));
      const result = await service.findActiveGrant('org-1', 'principal-2', 'product-1');
      expect(result).toBeNull();
    });

    it('returns the grant when expiresAt is in the future', async () => {
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
      grantRepo.findOne.mockResolvedValue(makeGrant({ expiresAt: future }));
      const result = await service.findActiveGrant('org-1', 'principal-2', 'product-1');
      expect(result).not.toBeNull();
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
  // renewGrant() — F10.19 / Phase 5.13
  // -------------------------------------------------------------------------

  describe('renewGrant()', () => {
    const inAYear = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

    function portFixture(situationAEligibility: boolean) {
      return {
        id: 'port-1',
        orgId: 'org-1',
        productId: 'product-1',
        portType: 'output',
        situationAEligibility,
      };
    }

    function portRepoFor(ports: ReturnType<typeof portFixture>[]) {
      const repoMock = (service as unknown as { portRepo: { find: jest.Mock } }).portRepo;
      repoMock.find.mockResolvedValue(ports);
    }

    it('throws NotFoundException when the grant does not exist', async () => {
      grantRepo.findOne.mockResolvedValue(null);
      await expect(service.renewGrant('org-1', 'missing', 'principal-2')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when caller is not the grantee', async () => {
      grantRepo.findOne.mockResolvedValue(makeGrant({ granteePrincipalId: 'someone-else' }));
      await expect(service.renewGrant('org-1', 'grant-1', 'principal-2')).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when the grant is revoked (must submit a fresh request)', async () => {
      grantRepo.findOne.mockResolvedValue(makeGrant({ revokedAt: now }));
      await expect(service.renewGrant('org-1', 'grant-1', 'principal-2')).rejects.toThrow(ConflictException);
    });

    it('auto-renews when all output ports are Situation-A-eligible', async () => {
      grantRepo.findOne.mockResolvedValue(makeGrant({
        grantedAt: now,
        expiresAt: inAYear,
      }));
      grantRepo.save.mockImplementation((g: AccessGrantEntity) => Promise.resolve(g));
      portRepoFor([portFixture(true), portFixture(true)]);
      productRepo.findOne.mockResolvedValue(makeProduct() as never);

      const result = await service.renewGrant('org-1', 'grant-1', 'principal-2');

      expect(result.mode).toBe('auto_renewed');
      expect(result.grant).toBeDefined();
      expect(result.request).toBeUndefined();
      // Auto-renew resets both expiry-warning markers so the next cycle fires
      // again.
      expect(grantRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          expiryWarningSentAt: null,
          expiryWarning7dSentAt: null,
        }),
      );
      // Notification fires informing the grantee.
      expect(notificationsService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'access_grant_renewed',
          recipients: ['principal-2'],
          payload: expect.objectContaining({ mode: 'auto_renewed' }),
        }),
      );
    });

    it('triggers approval workflow when any output port requires per-product grant (Situation B)', async () => {
      grantRepo.findOne.mockResolvedValue(makeGrant({
        grantedAt: now,
        expiresAt: inAYear,
      }));
      portRepoFor([portFixture(true), portFixture(false)]); // mixed → B path
      productRepo.findOne.mockResolvedValue(makeProduct({ ownerPrincipalId: 'owner-1' }) as never);
      requestRepo.create.mockImplementation((dto: unknown) => dto as never);
      requestRepo.save.mockImplementation((r: AccessRequestEntity) =>
        Promise.resolve({ ...r, id: 'request-renew', requestedAt: new Date(), updatedAt: new Date() } as never),
      );

      const result = await service.renewGrant('org-1', 'grant-1', 'principal-2');

      expect(result.mode).toBe('approval_required');
      expect(result.request).toBeDefined();
      expect(result.grant).toBeUndefined();
      // The grant's expiresAt is unchanged in the approval-required path —
      // consumer keeps existing access while approval runs.
      expect(grantRepo.save).not.toHaveBeenCalled();
      // Owner gets the standard access_request_submitted notification,
      // with the renewal context in payload.renewalOfGrantId.
      expect(notificationsService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'access_request_submitted',
          recipients: ['owner-1'],
          payload: expect.objectContaining({ renewalOfGrantId: 'grant-1' }),
        }),
      );
    });

    it('approval-required path when no output ports exist (defensive: no all-A short-circuit)', async () => {
      grantRepo.findOne.mockResolvedValue(makeGrant({
        grantedAt: now,
        expiresAt: inAYear,
      }));
      portRepoFor([]); // empty — the all-A check requires non-empty
      productRepo.findOne.mockResolvedValue(makeProduct({ ownerPrincipalId: 'owner-1' }) as never);
      requestRepo.create.mockImplementation((dto: unknown) => dto as never);
      requestRepo.save.mockImplementation((r: AccessRequestEntity) =>
        Promise.resolve({ ...r, id: 'request-renew', requestedAt: new Date(), updatedAt: new Date() } as never),
      );

      const result = await service.renewGrant('org-1', 'grant-1', 'principal-2');
      expect(result.mode).toBe('approval_required');
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

    it('enqueues connection_package_refreshed per refreshed grant (F11.27)', async () => {
      const g1 = makeGrant({
        id: 'g1',
        granteePrincipalId: 'consumer-1',
        connectionPackage: { packageVersion: 3 } as Record<string, unknown>,
      });
      grantRepo.find.mockResolvedValue([g1]);
      const cps = (service as unknown as { connectionPackageService: { generateForProduct: jest.Mock } }).connectionPackageService;
      cps.generateForProduct.mockResolvedValueOnce(freshPackage);
      grantRepo.save.mockImplementation((g: AccessGrantEntity) => Promise.resolve(g));

      await service.refreshPackagesForProduct('org-1', 'product-1');

      expect(notificationsService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          category: 'connection_package_refreshed',
          recipients: ['consumer-1'],
          dedupKey: 'connection_package_refreshed:g1:4',
        }),
      );
    });

    it('does not enqueue when nothing was refreshed', async () => {
      grantRepo.find.mockResolvedValue([]);
      await service.refreshPackagesForProduct('org-1', 'product-1');
      expect(notificationsService.enqueue).not.toHaveBeenCalled();
    });

    it('still completes the refresh when notification enqueue fails (best-effort)', async () => {
      const g1 = makeGrant({
        id: 'g1',
        granteePrincipalId: 'consumer-1',
        connectionPackage: null,
      });
      grantRepo.find.mockResolvedValue([g1]);
      const cps = (service as unknown as { connectionPackageService: { generateForProduct: jest.Mock } }).connectionPackageService;
      cps.generateForProduct.mockResolvedValueOnce(freshPackage);
      grantRepo.save.mockImplementation((g: AccessGrantEntity) => Promise.resolve(g));
      notificationsService.enqueue.mockRejectedValueOnce(new Error('boom'));

      const result = await service.refreshPackagesForProduct('org-1', 'product-1');
      expect(result).toEqual({ refreshed: 1 });
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

    it('enqueues access_request_submitted notification to the product owner (F11.6)', async () => {
      grantRepo.findOne.mockResolvedValue(null);
      productRepo.findOne.mockResolvedValue(makeProduct({ ownerPrincipalId: 'owner-1' }));
      requestRepo.findOne.mockResolvedValue(null);
      const request = makeRequest();
      requestRepo.create.mockReturnValue(request);
      requestRepo.save.mockResolvedValue(request);
      eventRepo.create.mockImplementation((d: any) => d);
      eventRepo.save.mockResolvedValue(makeEvent());

      await service.submitRequest('org-1', { productId: 'product-1' }, 'principal-2');

      expect(notificationsService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          category: 'access_request_submitted',
          recipients: ['owner-1'],
          dedupKey: 'access_request_submitted:request-1',
        }),
      );
    });

    it('still returns the request even if the notification enqueue fails (best-effort)', async () => {
      grantRepo.findOne.mockResolvedValue(null);
      productRepo.findOne.mockResolvedValue(makeProduct());
      requestRepo.findOne.mockResolvedValue(null);
      const request = makeRequest();
      requestRepo.create.mockReturnValue(request);
      requestRepo.save.mockResolvedValue(request);
      eventRepo.create.mockImplementation((d: any) => d);
      eventRepo.save.mockResolvedValue(makeEvent());
      notificationsService.enqueue.mockRejectedValueOnce(new Error('notif boom'));

      const result = await service.submitRequest('org-1', { productId: 'product-1' }, 'principal-2');
      expect(result.status).toBe('pending');
    });
  });

  // -------------------------------------------------------------------------
  // approveRequest()
  // -------------------------------------------------------------------------

  describe('approveRequest()', () => {
    // Existing flow tests use ['org_admin'] so the ownership check (B-059) is
    // bypassed — the assertions here cover state transitions and notifications,
    // not the cross-domain ownership boundary which has its own tests.
    it('throws NotFoundException when request does not exist', async () => {
      requestRepo.findOne.mockResolvedValue(null);
      await expect(
        service.approveRequest('org-1', 'missing', {}, 'principal-1', ['org_admin']),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when request is not pending', async () => {
      requestRepo.findOne.mockResolvedValue(makeRequest({ status: 'denied' }));
      await expect(
        service.approveRequest('org-1', 'request-1', {}, 'principal-1', ['org_admin']),
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

      const result = await service.approveRequest('org-1', 'request-1', { note: 'OK' }, 'principal-1', ['org_admin']);

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

      await service.approveRequest('org-1', 'request-1', {}, 'principal-1', ['org_admin']);

      expect(temporalClient.workflow.getHandle).toHaveBeenCalledWith('approval-request-1');
    });

    it('enqueues access_request_approved notification to the requester (F11.7)', async () => {
      const request = makeRequest({ requesterPrincipalId: 'requester-1' });
      requestRepo.findOne.mockResolvedValue(request);
      requestRepo.save.mockImplementation((r: any) => Promise.resolve(r));
      const grant = makeGrant({ approvalRequestId: 'request-1', expiresAt: new Date('2026-12-31T00:00:00Z') });
      grantRepo.create.mockReturnValue(grant);
      grantRepo.save.mockResolvedValue(grant);
      eventRepo.create.mockImplementation((d: any) => d);
      eventRepo.save.mockResolvedValue(makeEvent({ action: 'approved' }));

      await service.approveRequest('org-1', 'request-1', { note: 'OK' }, 'principal-1', ['org_admin']);

      expect(notificationsService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          category: 'access_request_approved',
          recipients: ['requester-1'],
          dedupKey: 'access_request_approved:request-1',
        }),
      );
    });

    it('B-059: domain_owner of a different domain is rejected with 403 and a scope-violation audit row', async () => {
      requestRepo.findOne.mockResolvedValue(makeRequest());
      productRepo.findOne.mockResolvedValue(makeProduct({ ownerPrincipalId: 'owner-1' }));

      await expect(
        service.approveRequest('org-1', 'request-1', {}, 'different-domain-owner', ['domain_owner']),
      ).rejects.toThrow(ForbiddenException);

      expect(grantRepo.save).not.toHaveBeenCalled();
      expect(requestRepo.manager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit.audit_log'),
        expect.arrayContaining([
          'access_request.approve_blocked_scope_violation',
          'different-domain-owner',
        ]),
      );
    });

    it('B-059: domain_owner who owns the product is allowed through', async () => {
      requestRepo.findOne.mockResolvedValue(makeRequest());
      requestRepo.save.mockImplementation((r: any) => Promise.resolve(r));
      productRepo.findOne.mockResolvedValue(makeProduct({ ownerPrincipalId: 'owner-1' }));
      grantRepo.create.mockReturnValue(makeGrant());
      grantRepo.save.mockResolvedValue(makeGrant());
      eventRepo.create.mockImplementation((d: any) => d);
      eventRepo.save.mockResolvedValue(makeEvent());

      const result = await service.approveRequest('org-1', 'request-1', {}, 'owner-1', ['domain_owner']);

      expect(result.request.status).toBe('approved');
    });

    it('B-071 Model A: grant lands in the requesters org (not the approvers) on cross-org approval', async () => {
      // Cross-org marketplace flow: requester in org-A, product owned by
      // beta-industries (owner-1) in org-B. Approver is owner-1 acting
      // from their own JWT (orgId=org-B).
      const request = makeRequest({
        orgId: 'org-A',
        productId: 'product-cross',
        requesterPrincipalId: 'consumer-1',
      });
      requestRepo.findOne.mockResolvedValue(request);
      requestRepo.save.mockImplementation((r: any) => Promise.resolve(r));
      productRepo.findOne.mockResolvedValue(
        makeProduct({ id: 'product-cross', orgId: 'org-B', ownerPrincipalId: 'owner-1' }),
      );
      const grant = makeGrant({
        approvalRequestId: 'request-1',
        orgId: 'org-A',
        granteePrincipalId: 'consumer-1',
      });
      grantRepo.create.mockReturnValue(grant);
      grantRepo.save.mockResolvedValue(grant);
      eventRepo.create.mockImplementation((d: any) => d);
      eventRepo.save.mockResolvedValue(makeEvent({ action: 'approved', orgId: 'org-A' }));

      const result = await service.approveRequest(
        'org-B',
        'request-1',
        {},
        'owner-1',
        ['domain_owner'],
      );

      // Grant is created with the requesters orgId (Model A), not the approvers.
      expect(grantRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-A',
          granteePrincipalId: 'consumer-1',
          productId: 'product-cross',
        }),
      );
      // Approval-event records in the requesters org too.
      expect(eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-A',
          action: 'approved',
        }),
      );
      // Approval notification fires to the requester in their own org.
      expect(notificationsService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-A',
          category: 'access_request_approved',
          recipients: ['consumer-1'],
        }),
      );
      expect(result.request.status).toBe('approved');
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

      const result = await service.denyRequest('org-1', 'request-1', { note: 'Policy violation' }, 'principal-1', ['org_admin']);

      expect(result.status).toBe('denied');
      expect(result.resolvedBy).toBe('principal-1');
    });

    it('throws ConflictException when request is not pending', async () => {
      requestRepo.findOne.mockResolvedValue(makeRequest({ status: 'approved' }));
      await expect(
        service.denyRequest('org-1', 'request-1', {}, 'principal-1', ['org_admin']),
      ).rejects.toThrow(ConflictException);
    });

    it('B-059: domain_owner of a different domain is rejected with 403 and a scope-violation audit row', async () => {
      requestRepo.findOne.mockResolvedValue(makeRequest());
      productRepo.findOne.mockResolvedValue(makeProduct({ ownerPrincipalId: 'owner-1' }));

      await expect(
        service.denyRequest('org-1', 'request-1', {}, 'different-domain-owner', ['domain_owner']),
      ).rejects.toThrow(ForbiddenException);

      expect(requestRepo.save).not.toHaveBeenCalled();
      expect(requestRepo.manager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit.audit_log'),
        expect.arrayContaining([
          'access_request.deny_blocked_scope_violation',
          'different-domain-owner',
        ]),
      );
    });

    it('enqueues access_request_denied notification to the requester (F11.8)', async () => {
      const request = makeRequest({ requesterPrincipalId: 'requester-1' });
      requestRepo.findOne.mockResolvedValue(request);
      requestRepo.save.mockImplementation((r: any) => Promise.resolve(r));
      eventRepo.create.mockImplementation((d: any) => d);
      eventRepo.save.mockResolvedValue(makeEvent({ action: 'denied' }));

      await service.denyRequest('org-1', 'request-1', { note: 'Insufficient justification' }, 'principal-1', ['org_admin']);

      expect(notificationsService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          category: 'access_request_denied',
          recipients: ['requester-1'],
          dedupKey: 'access_request_denied:request-1',
          payload: expect.objectContaining({ reason: 'Insufficient justification' }),
        }),
      );
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
        service.listApprovalEvents('org-1', 'missing', 'principal-2', {
          limit: 20,
          offset: 0,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns paginated events when the caller is the requester', async () => {
      requestRepo.findOne.mockResolvedValue(
        makeRequest({ requesterPrincipalId: 'principal-2' }),
      );
      eventRepo.findAndCount.mockResolvedValue([[makeEvent()], 1]);

      const result = await service.listApprovalEvents(
        'org-1',
        'request-1',
        'principal-2',
        { limit: 20, offset: 0 },
      );

      expect(result.meta.total).toBe(1);
      expect(result.items[0].action).toBe('submitted');
    });
  });
});
