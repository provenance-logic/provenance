import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ProductsService } from '../products.service.js';
import { DataProductEntity } from '../entities/data-product.entity.js';
import { PortDeclarationEntity } from '../entities/port-declaration.entity.js';
import { ProductVersionEntity } from '../entities/product-version.entity.js';
import { LifecycleEventEntity } from '../entities/lifecycle-event.entity.js';
import { PrincipalEntity } from '../../organizations/entities/principal.entity.js';
import { GovernanceService } from '../../governance/governance.service.js';
import { KafkaProducerService } from '../../kafka/kafka-producer.service.js';
import { SearchIndexingService } from '../../search/search-indexing.service.js';
import { ProductEnrichmentService } from '../product-enrichment.service.js';
import type { DataClassification } from '@provenance/types';

// ---------------------------------------------------------------------------
// Repository mock factory
// ---------------------------------------------------------------------------

const mockRepo = () => ({
  findAndCount: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
});

const mockGovernanceService = () => ({
  evaluate: jest.fn().mockResolvedValue({
    evaluated: 1,
    compliant: 1,
    nonCompliant: 0,
    driftDetected: 0,
    gracePeriod: 0,
    violations: [],
  }),
});

const mockKafkaProducerService = () => ({
  publish: jest.fn().mockResolvedValue(undefined),
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = new Date('2024-01-01T00:00:00Z');

const mockCtx = {
  principalId: 'principal-1',
  orgId: 'org-1',
  principalType: 'human_user' as const,
  roles: [],
  keycloakSubject: 'keycloak-sub-1',
};

const makeProductEntity = (
  overrides: Partial<DataProductEntity> = {},
): DataProductEntity => ({
  id: 'product-1',
  orgId: 'org-1',
  domainId: 'domain-1',
  name: 'Orders',
  slug: 'orders',
  description: 'Order data product',
  status: 'draft',
  version: '0.1.0',
  classification: 'internal' as DataClassification,
  ownerPrincipalId: 'principal-1',
  tags: [],
  ports: [],
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const makeOutputPortEntity = (
  overrides: Partial<PortDeclarationEntity> = {},
): PortDeclarationEntity => ({
  id: 'port-output-1',
  orgId: 'org-1',
  productId: 'product-1',
  portType: 'output',
  name: 'Orders Output',
  description: null,
  interfaceType: 'rest_api',
  contractSchema: { type: 'object' },
  slaDescription: null,
  createdAt: now,
  updatedAt: now,
  product: null as any,
  ...overrides,
});

const makeDiscoveryPortEntity = (): PortDeclarationEntity => ({
  id: 'port-discovery-1',
  orgId: 'org-1',
  productId: 'product-1',
  portType: 'discovery',
  name: 'Orders Discovery',
  description: null,
  interfaceType: null,
  contractSchema: null,
  slaDescription: null,
  createdAt: now,
  updatedAt: now,
  product: null as any,
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

const mockPrincipalRepo = () => ({
  findOne: jest.fn(),
  findOneOrFail: jest.fn(),
  createQueryBuilder: jest.fn().mockReturnValue({
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({}),
  }),
});

describe('ProductsService', () => {
  let service: ProductsService;
  let module: Awaited<ReturnType<typeof Test.createTestingModule.prototype.compile>>;
  let productRepo: ReturnType<typeof mockRepo>;
  let portRepo: ReturnType<typeof mockRepo>;
  let versionRepo: ReturnType<typeof mockRepo>;
  let lifecycleEventRepo: ReturnType<typeof mockRepo>;
  let principalRepo: ReturnType<typeof mockPrincipalRepo>;
  let governanceService: ReturnType<typeof mockGovernanceService>;
  let kafkaProducerService: ReturnType<typeof mockKafkaProducerService>;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: getRepositoryToken(DataProductEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(PortDeclarationEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(ProductVersionEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(LifecycleEventEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(PrincipalEntity), useFactory: mockPrincipalRepo },
        { provide: GovernanceService, useFactory: mockGovernanceService },
        { provide: KafkaProducerService, useFactory: mockKafkaProducerService },
        { provide: SearchIndexingService, useValue: { indexProduct: jest.fn().mockResolvedValue(undefined), removeProduct: jest.fn().mockResolvedValue(undefined) } },
        { provide: ProductEnrichmentService, useValue: { enrich: jest.fn().mockResolvedValue({ owner: null, domainTeam: null, freshness: null, accessStatus: null, columnSchema: null }) } },
      ],
    }).compile();

    service = module.get(ProductsService);
    productRepo = module.get(getRepositoryToken(DataProductEntity));
    portRepo = module.get(getRepositoryToken(PortDeclarationEntity));
    versionRepo = module.get(getRepositoryToken(ProductVersionEntity));
    lifecycleEventRepo = module.get(getRepositoryToken(LifecycleEventEntity));
    principalRepo = module.get(getRepositoryToken(PrincipalEntity));
    governanceService = module.get(GovernanceService);
    kafkaProducerService = module.get(KafkaProducerService);
  });

  // ---------------------------------------------------------------------------
  // createProduct()
  // ---------------------------------------------------------------------------

  describe('createProduct()', () => {
    it('creates a product in draft status at version 0.1.0', async () => {
      productRepo.findOne.mockResolvedValue(null);
      principalRepo.findOne.mockResolvedValue({ id: 'principal-1', keycloakSubject: 'keycloak-sub-1' });
      const entity = makeProductEntity();
      productRepo.create.mockReturnValue(entity);
      productRepo.save.mockResolvedValue(entity);
      versionRepo.create.mockImplementation((d: any) => d);
      versionRepo.save.mockResolvedValue({});

      const result = await service.createProduct(
        'org-1',
        'domain-1',
        {
          name: 'Orders',
          slug: 'orders',
          classification: 'internal',
          ownerPrincipalId: 'principal-1',
        },
        mockCtx,
      );

      expect(result.status).toBe('draft');
      expect(result.version).toBe('0.1.0');
      expect(productRepo.save).toHaveBeenCalled();
    });

    it('records an initial version snapshot on creation', async () => {
      productRepo.findOne.mockResolvedValue(null);
      principalRepo.findOne.mockResolvedValue({ id: 'principal-1', keycloakSubject: 'keycloak-sub-1' });
      const entity = makeProductEntity();
      productRepo.create.mockReturnValue(entity);
      productRepo.save.mockResolvedValue(entity);
      versionRepo.create.mockImplementation((d: any) => d);
      versionRepo.save.mockResolvedValue({});

      await service.createProduct('org-1', 'domain-1', {
        name: 'Orders', slug: 'orders', classification: 'internal', ownerPrincipalId: 'p-1',
      }, mockCtx);

      expect(versionRepo.save).toHaveBeenCalled();
      expect(versionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ version: '0.1.0', changeDescription: 'Initial draft' }),
      );
    });

    it('throws ConflictException when slug already exists in the domain', async () => {
      productRepo.findOne.mockResolvedValue(makeProductEntity());

      await expect(
        service.createProduct('org-1', 'domain-1', {
          name: 'Orders', slug: 'orders', classification: 'internal', ownerPrincipalId: 'p-1',
        }, mockCtx),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ---------------------------------------------------------------------------
  // getProduct()
  // ---------------------------------------------------------------------------

  describe('getProduct()', () => {
    it('returns the product with ports', async () => {
      const entity = makeProductEntity({
        ports: [makeOutputPortEntity()],
      });
      productRepo.findOne.mockResolvedValue(entity);

      const result = await service.getProduct('org-1', 'domain-1', 'product-1');

      expect(result.id).toBe('product-1');
      expect(result.ports).toHaveLength(1);
    });

    it('throws NotFoundException when product does not exist', async () => {
      productRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getProduct('org-1', 'domain-1', 'missing'),
      ).rejects.toThrow(NotFoundException);
    });

    // 5.4 P1 enrichment fields are tested in product-enrichment.service.spec.ts.
    // Here we just verify ProductsService delegates to the enrichment service
    // and merges the result into the response.
    it('merges ProductEnrichmentService output into the returned DataProduct', async () => {
      const entity = makeProductEntity({ ports: [] });
      productRepo.findOne.mockResolvedValue(entity);
      const enrichment = module.get(ProductEnrichmentService) as { enrich: jest.Mock };
      enrichment.enrich.mockResolvedValueOnce({
        owner:        { id: 'principal-1', displayName: 'Jane', email: 'jane@ex.com' },
        domainTeam:   null,
        freshness:    null,
        accessStatus: { status: 'granted', grantedAt: now.toISOString(), expiresAt: null },
        columnSchema: null,
      });

      const result = await service.getProduct('org-1', 'domain-1', 'product-1', mockCtx);

      expect(enrichment.enrich).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'product-1', orgId: 'org-1', domainId: 'domain-1' }),
        mockCtx,
      );
      expect(result.owner).toEqual({ id: 'principal-1', displayName: 'Jane', email: 'jane@ex.com' });
      expect(result.accessStatus).toMatchObject({ status: 'granted' });
    });
  });

  // ---------------------------------------------------------------------------
  // updateProduct()
  // ---------------------------------------------------------------------------

  describe('updateProduct()', () => {
    it('updates mutable fields on a draft product', async () => {
      const entity = makeProductEntity({ ports: [] });
      productRepo.findOne.mockResolvedValue(entity);
      productRepo.save.mockImplementation((e: any) => Promise.resolve(e));

      const result = await service.updateProduct('org-1', 'domain-1', 'product-1', {
        name: 'Renamed Orders',
      });

      expect(result.name).toBe('Renamed Orders');
    });

    it('throws ConflictException when product is not in draft status', async () => {
      productRepo.findOne.mockResolvedValue(makeProductEntity({ status: 'deprecated', ports: [] }));

      await expect(
        service.updateProduct('org-1', 'domain-1', 'product-1', { name: 'X' }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when product does not exist', async () => {
      productRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateProduct('org-1', 'domain-1', 'missing', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // deleteProduct()
  // ---------------------------------------------------------------------------

  describe('deleteProduct()', () => {
    it('deletes a draft product', async () => {
      productRepo.findOne.mockResolvedValue(makeProductEntity());
      productRepo.remove.mockResolvedValue(undefined);

      await expect(
        service.deleteProduct('org-1', 'domain-1', 'product-1'),
      ).resolves.toBeUndefined();
      expect(productRepo.remove).toHaveBeenCalled();
    });

    it('throws ConflictException when product is not in draft status', async () => {
      productRepo.findOne.mockResolvedValue(makeProductEntity({ status: 'published' }));

      await expect(
        service.deleteProduct('org-1', 'domain-1', 'product-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when product does not exist', async () => {
      productRepo.findOne.mockResolvedValue(null);

      await expect(
        service.deleteProduct('org-1', 'domain-1', 'missing'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // declarePort()
  // ---------------------------------------------------------------------------

  describe('declarePort()', () => {
    it('creates and returns a new port', async () => {
      const entity = makeOutputPortEntity();
      portRepo.create.mockReturnValue(entity);
      portRepo.save.mockResolvedValue(entity);

      const result = await service.declarePort('org-1', 'product-1', {
        portType: 'output',
        name: 'Orders Output',
        interfaceType: 'rest_api',
        contractSchema: { type: 'object' },
      });

      expect(result.portType).toBe('output');
      expect(result.name).toBe('Orders Output');
    });
  });

  // ---------------------------------------------------------------------------
  // getPort()
  // ---------------------------------------------------------------------------

  describe('getPort()', () => {
    it('returns the port when found', async () => {
      portRepo.findOne.mockResolvedValue(makeOutputPortEntity());

      const result = await service.getPort('org-1', 'product-1', 'port-output-1');
      expect(result.id).toBe('port-output-1');
    });

    it('throws NotFoundException when port does not exist', async () => {
      portRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getPort('org-1', 'product-1', 'missing'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // updatePort()
  // ---------------------------------------------------------------------------

  describe('updatePort()', () => {
    it('updates port fields', async () => {
      const entity = makeOutputPortEntity();
      portRepo.findOne.mockResolvedValue(entity);
      portRepo.save.mockImplementation((e: any) => Promise.resolve(e));

      const result = await service.updatePort('org-1', 'product-1', 'port-output-1', {
        name: 'Renamed Port',
      });

      expect(result.name).toBe('Renamed Port');
    });

    it('throws NotFoundException when port does not exist', async () => {
      portRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updatePort('org-1', 'product-1', 'missing', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // deletePort()
  // ---------------------------------------------------------------------------

  describe('deletePort()', () => {
    it('removes the port', async () => {
      portRepo.findOne.mockResolvedValue(makeOutputPortEntity());
      portRepo.remove.mockResolvedValue(undefined);

      await expect(
        service.deletePort('org-1', 'product-1', 'port-output-1'),
      ).resolves.toBeUndefined();
      expect(portRepo.remove).toHaveBeenCalled();
    });

    it('throws NotFoundException when port does not exist', async () => {
      portRepo.findOne.mockResolvedValue(null);

      await expect(
        service.deletePort('org-1', 'product-1', 'missing'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // publishProduct()
  // ---------------------------------------------------------------------------

  describe('publishProduct()', () => {
    const validPorts = () => [makeOutputPortEntity(), makeDiscoveryPortEntity()];

    const setupValidPublish = () => {
      const entity = makeProductEntity({ ports: validPorts() });
      productRepo.findOne.mockResolvedValue(entity);
      principalRepo.findOne.mockResolvedValue({ id: 'principal-1', keycloakSubject: 'keycloak-sub-1' });
      productRepo.save.mockImplementation((e: any) => Promise.resolve(e));
      lifecycleEventRepo.create.mockImplementation((d: any) => d);
      lifecycleEventRepo.save.mockResolvedValue({});
      versionRepo.create.mockImplementation((d: any) => d);
      versionRepo.save.mockResolvedValue({});
      return entity;
    };

    it('throws NotFoundException when product does not exist', async () => {
      principalRepo.findOne.mockResolvedValue({ id: 'principal-1', keycloakSubject: 'keycloak-sub-1' });
      productRepo.findOne.mockResolvedValue(null);

      await expect(
        service.publishProduct('org-1', 'domain-1', 'missing', {}, mockCtx),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when product is not in draft status', async () => {
      principalRepo.findOne.mockResolvedValue({ id: 'principal-1', keycloakSubject: 'keycloak-sub-1' });
      productRepo.findOne.mockResolvedValue(
        makeProductEntity({ status: 'published', ports: validPorts() }),
      );

      await expect(
        service.publishProduct('org-1', 'domain-1', 'product-1', {}, mockCtx),
      ).rejects.toThrow(ConflictException);
    });

    it('throws UnprocessableEntityException when there are no output ports', async () => {
      principalRepo.findOne.mockResolvedValue({ id: 'principal-1', keycloakSubject: 'keycloak-sub-1' });
      productRepo.findOne.mockResolvedValue(
        makeProductEntity({ ports: [makeDiscoveryPortEntity()] }),
      );

      await expect(
        service.publishProduct('org-1', 'domain-1', 'product-1', {}, mockCtx),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws UnprocessableEntityException when there are no discovery ports', async () => {
      principalRepo.findOne.mockResolvedValue({ id: 'principal-1', keycloakSubject: 'keycloak-sub-1' });
      productRepo.findOne.mockResolvedValue(
        makeProductEntity({ ports: [makeOutputPortEntity()] }),
      );

      await expect(
        service.publishProduct('org-1', 'domain-1', 'product-1', {}, mockCtx),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws UnprocessableEntityException when an output port is missing a contract schema', async () => {
      principalRepo.findOne.mockResolvedValue({ id: 'principal-1', keycloakSubject: 'keycloak-sub-1' });
      productRepo.findOne.mockResolvedValue(
        makeProductEntity({
          ports: [
            makeOutputPortEntity({ contractSchema: null }),
            makeDiscoveryPortEntity(),
          ],
        }),
      );

      await expect(
        service.publishProduct('org-1', 'domain-1', 'product-1', {}, mockCtx),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws UnprocessableEntityException with violation details when governance blocks publication', async () => {
      setupValidPublish();
      governanceService.evaluate.mockResolvedValueOnce({
        evaluated: 1,
        compliant: 0,
        nonCompliant: 1,
        driftDetected: 0,
        gracePeriod: 0,
        violations: [
          { ruleId: 'require_classification', detail: 'public not allowed', policyDomain: 'access_control' },
        ],
      });

      await expect(
        service.publishProduct('org-1', 'domain-1', 'product-1', {}, mockCtx),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('bumps major version from 0.1.0 to 1.0.0 on first publish', async () => {
      setupValidPublish();

      const result = await service.publishProduct(
        'org-1', 'domain-1', 'product-1', {}, mockCtx,
      );

      expect(productRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'published', version: '1.0.0' }),
      );
      expect(result.version).toBe('1.0.0');
    });

    it('sets product status to published', async () => {
      setupValidPublish();

      const result = await service.publishProduct(
        'org-1', 'domain-1', 'product-1', {}, mockCtx,
      );

      expect(result.status).toBe('published');
    });

    it('writes an append-only lifecycle event from draft to published', async () => {
      setupValidPublish();

      await service.publishProduct('org-1', 'domain-1', 'product-1', {}, mockCtx);

      expect(lifecycleEventRepo.save).toHaveBeenCalled();
      expect(lifecycleEventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fromStatus: 'draft',
          toStatus: 'published',
          triggeredBy: 'principal-1',
        }),
      );
    });

    it('creates an immutable ProductVersion snapshot', async () => {
      setupValidPublish();

      await service.publishProduct(
        'org-1', 'domain-1', 'product-1',
        { changeDescription: 'First release' },
        mockCtx,
      );

      expect(versionRepo.save).toHaveBeenCalled();
      expect(versionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          version: '1.0.0',
          changeDescription: 'First release',
          createdByPrincipalId: 'principal-1',
        }),
      );
    });

    it('publishes a ProductPublishedEvent to the product.lifecycle Kafka topic', async () => {
      setupValidPublish();

      await service.publishProduct('org-1', 'domain-1', 'product-1', {}, mockCtx);

      expect(kafkaProducerService.publish).toHaveBeenCalledWith(
        'product.lifecycle',
        'product-1',
        expect.objectContaining({
          eventType: 'product.published',
          schemaVersion: '1.0',
          orgId: 'org-1',
          productId: 'product-1',
          version: '1.0.0',
        }),
      );
    });

    it('calls governance.evaluate with the product before publishing', async () => {
      setupValidPublish();

      await service.publishProduct('org-1', 'domain-1', 'product-1', {}, mockCtx);

      expect(governanceService.evaluate).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ id: 'product-1' }),
      );
    });

    it('passes changeDescription from the request to the lifecycle event note', async () => {
      setupValidPublish();

      await service.publishProduct(
        'org-1', 'domain-1', 'product-1',
        { changeDescription: 'Production ready' },
        mockCtx,
      );

      expect(lifecycleEventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ note: 'Production ready' }),
      );
    });
  });
});
