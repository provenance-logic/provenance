import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { AccessService } from './access.service.js';
import { AccessGrantEntity } from './entities/access-grant.entity.js';
import { AccessRequestEntity } from './entities/access-request.entity.js';
import { ApprovalEventEntity } from './entities/approval-event.entity.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { TEMPORAL_CLIENT } from './temporal/temporal-client.provider.js';
import { createApprovalActivities } from './temporal/approval.activities.js';
import { ConnectionPackageService } from './connection-package.service.js';

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
const future = new Date('2025-01-01T00:00:00Z');

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

const makeProduct = (overrides: Partial<DataProductEntity> = {}): DataProductEntity => ({
  id: 'product-1',
  orgId: 'org-1',
  domainId: 'domain-1',
  name: 'My Product',
  slug: 'my-product',
  description: null,
  status: 'published',
  version: '1.0.0',
  classification: 'internal',
  ownerPrincipalId: 'principal-1',
  tags: [],
  createdAt: now,
  updatedAt: now,
  ports: [],
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

// ---------------------------------------------------------------------------
// Tests — AccessService
// ---------------------------------------------------------------------------

describe('AccessService', () => {
  let service: AccessService;
  let grantRepo: ReturnType<typeof mockRepo>;
  let requestRepo: ReturnType<typeof mockRepo>;
  let eventRepo: ReturnType<typeof mockRepo>;
  let productRepo: ReturnType<typeof mockRepo>;
  let temporalClient: ReturnType<typeof mockTemporalClient>;

  beforeEach(async () => {
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
      ],
    }).compile();

    service        = module.get(AccessService);
    grantRepo      = module.get(getRepositoryToken(AccessGrantEntity));
    requestRepo    = module.get(getRepositoryToken(AccessRequestEntity));
    eventRepo      = module.get(getRepositoryToken(ApprovalEventEntity));
    productRepo    = module.get(getRepositoryToken(DataProductEntity));
    temporalClient = module.get(TEMPORAL_CLIENT);
  });

  // -------------------------------------------------------------------------
  // Access request creation
  // -------------------------------------------------------------------------

  describe('submitRequest()', () => {
    it('consumer can submit an access request when no existing grant or pending request exists', async () => {
      grantRepo.findOne.mockResolvedValue(null);
      productRepo.findOne.mockResolvedValue(makeProduct());
      requestRepo.findOne.mockResolvedValue(null);
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
      expect(result.productId).toBe('product-1');
    });

    it('rejects with ConflictException when a pending request already exists for this consumer + product', async () => {
      grantRepo.findOne.mockResolvedValue(null);
      productRepo.findOne.mockResolvedValue(makeProduct());
      requestRepo.findOne.mockResolvedValue(makeRequest({ status: 'pending' }));

      await expect(
        service.submitRequest('org-1', { productId: 'product-1' }, 'principal-2'),
      ).rejects.toThrow(ConflictException);

      expect(requestRepo.save).not.toHaveBeenCalled();
    });

    it('rejects with ConflictException when an active (non-revoked, non-expired) grant already exists for this consumer + product', async () => {
      grantRepo.findOne.mockResolvedValue(makeGrant({ revokedAt: null, expiresAt: null }));

      await expect(
        service.submitRequest('org-1', { productId: 'product-1' }, 'principal-2'),
      ).rejects.toThrow(ConflictException);
    });

    it.each([
      ['draft'],
      ['deprecated'],
      ['decommissioned'],
    ] as const)(
      'rejects with ConflictException when the product status is %s',
      async (status) => {
        grantRepo.findOne.mockResolvedValue(null);
        productRepo.findOne.mockResolvedValue(makeProduct({ status }));

        await expect(
          service.submitRequest('org-1', { productId: 'product-1' }, 'principal-2'),
        ).rejects.toThrow(ConflictException);

        expect(requestRepo.save).not.toHaveBeenCalled();
      },
    );

    it('rejects with NotFoundException when the product does not exist', async () => {
      grantRepo.findOne.mockResolvedValue(null);
      productRepo.findOne.mockResolvedValue(null);

      await expect(
        service.submitRequest('org-1', { productId: 'missing-product' }, 'principal-2'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects with ForbiddenException when a consumer in org A requests access to a product owned by org B', async () => {
      grantRepo.findOne.mockResolvedValue(null);
      // Product exists but belongs to a different org.
      productRepo.findOne.mockResolvedValue(makeProduct({ orgId: 'org-B' }));

      await expect(
        service.submitRequest('org-A', { productId: 'product-1' }, 'principal-2'),
      ).rejects.toThrow(ForbiddenException);

      expect(requestRepo.save).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Approval and denial
  // -------------------------------------------------------------------------

  describe('approveRequest()', () => {
    it('domain owner can approve a pending request — creates a grant with the specified expiration', async () => {
      const request = makeRequest();
      requestRepo.findOne.mockResolvedValue(request);
      requestRepo.save.mockImplementation((r: any) => Promise.resolve(r));
      const grant = makeGrant({ approvalRequestId: 'request-1', expiresAt: future });
      grantRepo.create.mockReturnValue(grant);
      grantRepo.save.mockResolvedValue(grant);
      eventRepo.create.mockImplementation((d: any) => d);
      eventRepo.save.mockResolvedValue(makeEvent({ action: 'approved' }));

      const result = await service.approveRequest(
        'org-1',
        'request-1',
        { note: 'Approved by domain owner', expiresAt: future.toISOString() },
        'domain-owner-1',
      );

      expect(requestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'approved', resolvedBy: 'domain-owner-1' }),
      );
      expect(grantRepo.save).toHaveBeenCalled();
      expect(result.request.status).toBe('approved');
      expect(result.grant.approvalRequestId).toBe('request-1');
      expect(result.grant.expiresAt).toBe(future.toISOString());
    });

    it('org admin can approve a pending request', async () => {
      const request = makeRequest();
      requestRepo.findOne.mockResolvedValue(request);
      requestRepo.save.mockImplementation((r: any) => Promise.resolve(r));
      grantRepo.create.mockReturnValue(makeGrant({ approvalRequestId: 'request-1' }));
      grantRepo.save.mockResolvedValue(makeGrant({ approvalRequestId: 'request-1' }));
      eventRepo.create.mockImplementation((d: any) => d);
      eventRepo.save.mockResolvedValue(makeEvent({ action: 'approved' }));

      const result = await service.approveRequest(
        'org-1',
        'request-1',
        {},
        'org-admin-1',
      );

      expect(result.request.status).toBe('approved');
      expect(result.grant).toBeDefined();
    });

    it.todo('any other role attempting approval returns 403 — role enforcement is handled at the controller layer (RolesGuard), not in the service');

    it('throws ConflictException when attempting to approve an already-resolved request', async () => {
      requestRepo.findOne.mockResolvedValue(makeRequest({ status: 'approved' }));

      await expect(
        service.approveRequest('org-1', 'request-1', {}, 'principal-1'),
      ).rejects.toThrow(ConflictException);

      expect(grantRepo.save).not.toHaveBeenCalled();
    });

    it('signals the Temporal workflow after a successful approval', async () => {
      const request = makeRequest({ temporalWorkflowId: 'approval-request-1' });
      requestRepo.findOne.mockResolvedValue(request);
      requestRepo.save.mockImplementation((r: any) => Promise.resolve(r));
      grantRepo.create.mockReturnValue(makeGrant());
      grantRepo.save.mockResolvedValue(makeGrant());
      eventRepo.create.mockImplementation((d: any) => d);
      eventRepo.save.mockResolvedValue(makeEvent());

      await service.approveRequest('org-1', 'request-1', {}, 'principal-1');

      expect(temporalClient.workflow.getHandle).toHaveBeenCalledWith('approval-request-1');
      expect(temporalClient.workflow.getHandle('approval-request-1').signal).toHaveBeenCalled();
    });
  });

  describe('denyRequest()', () => {
    it('transitions request to denied and records a denied event without creating a grant', async () => {
      const request = makeRequest();
      requestRepo.findOne.mockResolvedValue(request);
      requestRepo.save.mockImplementation((r: any) => Promise.resolve(r));
      eventRepo.create.mockImplementation((d: any) => d);
      eventRepo.save.mockResolvedValue(makeEvent({ action: 'denied' }));

      const result = await service.denyRequest(
        'org-1',
        'request-1',
        { note: 'Policy violation' },
        'principal-1',
      );

      expect(result.status).toBe('denied');
      expect(result.resolvedBy).toBe('principal-1');
      expect(grantRepo.save).not.toHaveBeenCalled();
    });

    it('throws ConflictException when attempting to deny an already-resolved request', async () => {
      requestRepo.findOne.mockResolvedValue(makeRequest({ status: 'approved' }));

      await expect(
        service.denyRequest('org-1', 'request-1', {}, 'principal-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  // -------------------------------------------------------------------------
  // Double-approval idempotency
  // -------------------------------------------------------------------------

  describe('double-approval idempotency', () => {
    it('throws ConflictException on the second approval attempt — grant is created exactly once', async () => {
      // First approval succeeds.
      const request = makeRequest();
      requestRepo.findOne
        .mockResolvedValueOnce(request)                          // first findOne → pending
        .mockResolvedValueOnce(makeRequest({ status: 'approved' })); // second findOne → already resolved
      requestRepo.save.mockImplementation((r: any) => Promise.resolve(r));
      grantRepo.create.mockReturnValue(makeGrant());
      grantRepo.save.mockResolvedValue(makeGrant());
      eventRepo.create.mockImplementation((d: any) => d);
      eventRepo.save.mockResolvedValue(makeEvent());

      await service.approveRequest('org-1', 'request-1', {}, 'principal-1');

      // Second approval attempt must be rejected.
      await expect(
        service.approveRequest('org-1', 'request-1', {}, 'principal-1'),
      ).rejects.toThrow(ConflictException);

      // The grant was saved exactly once across both calls.
      expect(grantRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Withdrawal
  // -------------------------------------------------------------------------

  describe('withdrawRequest()', () => {
    it('allows the original requester to withdraw a pending request', async () => {
      const request = makeRequest({ requesterPrincipalId: 'principal-2' });
      requestRepo.findOne.mockResolvedValue(request);
      requestRepo.save.mockImplementation((r: any) => Promise.resolve(r));
      eventRepo.create.mockImplementation((d: any) => d);
      eventRepo.save.mockResolvedValue(makeEvent({ action: 'withdrawn' }));

      const result = await service.withdrawRequest('org-1', 'request-1', {}, 'principal-2');

      expect(result.status).toBe('withdrawn');
      expect(result.resolvedBy).toBe('principal-2');
    });

    it('throws ForbiddenException when a different principal attempts to withdraw', async () => {
      requestRepo.findOne.mockResolvedValue(makeRequest({ requesterPrincipalId: 'principal-2' }));

      await expect(
        service.withdrawRequest('org-1', 'request-1', {}, 'different-principal'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when the request is no longer pending', async () => {
      requestRepo.findOne.mockResolvedValue(
        makeRequest({ status: 'approved', requesterPrincipalId: 'principal-2' }),
      );

      await expect(
        service.withdrawRequest('org-1', 'request-1', {}, 'principal-2'),
      ).rejects.toThrow(ConflictException);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests — approval activities (timeout and escalation behavior)
// ---------------------------------------------------------------------------

describe('approval activities — timeout and escalation behavior', () => {
  const makeActivityMockRepo = () => ({
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  });

  let requestRepo: ReturnType<typeof makeActivityMockRepo>;
  let eventRepo: ReturnType<typeof makeActivityMockRepo>;
  let activities: ReturnType<typeof createApprovalActivities>;

  beforeEach(() => {
    requestRepo = makeActivityMockRepo();
    eventRepo   = makeActivityMockRepo();
    activities  = createApprovalActivities({
      requestRepo: requestRepo as any,
      eventRepo:   eventRepo   as any,
    });
  });

  // -------------------------------------------------------------------------
  // escalateApprovalRequest
  // -------------------------------------------------------------------------

  describe('escalateApprovalRequest()', () => {
    it('records an escalated event when the request is still pending', async () => {
      requestRepo.findOne.mockResolvedValue(makeRequest({ status: 'pending' }));
      eventRepo.create.mockImplementation((d: any) => d);
      eventRepo.save.mockResolvedValue({});

      await activities.escalateApprovalRequest('request-1', 'org-1');

      expect(eventRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'escalated', performedBy: null }),
      );
    });

    it('is a no-op when the request has already been resolved (human acted first)', async () => {
      requestRepo.findOne.mockResolvedValue(makeRequest({ status: 'approved' }));

      await activities.escalateApprovalRequest('request-1', 'org-1');

      expect(eventRepo.save).not.toHaveBeenCalled();
    });

    it('is a no-op when the request does not exist', async () => {
      requestRepo.findOne.mockResolvedValue(null);

      await activities.escalateApprovalRequest('request-1', 'org-1');

      expect(eventRepo.save).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // expireApprovalRequest
  // -------------------------------------------------------------------------

  describe('expireApprovalRequest()', () => {
    it('transitions a pending request to denied and records an expired event when the escalation timeout elapses', async () => {
      const request = makeRequest({ status: 'pending' });
      requestRepo.findOne.mockResolvedValue(request);
      requestRepo.save.mockImplementation((r: any) => Promise.resolve(r));
      eventRepo.create.mockImplementation((d: any) => d);
      eventRepo.save.mockResolvedValue({});

      await activities.expireApprovalRequest('request-1', 'org-1');

      expect(requestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'denied' }),
      );
      expect(eventRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'expired', performedBy: null }),
      );
    });

    it('sets a resolutionNote indicating automatic expiry', async () => {
      const request = makeRequest({ status: 'pending' });
      requestRepo.findOne.mockResolvedValue(request);
      requestRepo.save.mockImplementation((r: any) => Promise.resolve(r));
      eventRepo.create.mockImplementation((d: any) => d);
      eventRepo.save.mockResolvedValue({});

      await activities.expireApprovalRequest('request-1', 'org-1');

      expect(requestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          resolutionNote: expect.stringContaining('expired'),
        }),
      );
    });

    it('is a no-op when a human approved or denied just before the expiry activity ran', async () => {
      requestRepo.findOne.mockResolvedValue(makeRequest({ status: 'approved' }));

      await activities.expireApprovalRequest('request-1', 'org-1');

      expect(requestRepo.save).not.toHaveBeenCalled();
      expect(eventRepo.save).not.toHaveBeenCalled();
    });

    it('is a no-op when the request does not exist', async () => {
      requestRepo.findOne.mockResolvedValue(null);

      await activities.expireApprovalRequest('request-1', 'org-1');

      expect(requestRepo.save).not.toHaveBeenCalled();
      expect(eventRepo.save).not.toHaveBeenCalled();
    });
  });
});
