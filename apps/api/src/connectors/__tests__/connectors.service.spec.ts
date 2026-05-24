import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ConnectorsService } from '../connectors.service.js';
import { ConnectorEntity } from '../entities/connector.entity.js';
import { ConnectorHealthEventEntity } from '../entities/connector-health-event.entity.js';
import { SourceRegistrationEntity } from '../entities/source-registration.entity.js';
import { SchemaSnapshotEntity } from '../entities/schema-snapshot.entity.js';
import { DiscoveryCrawlEventEntity } from '../entities/discovery-crawl-event.entity.js';
import { CapabilityManifestEntity } from '../entities/capability-manifest.entity.js';
import { CapabilityManifestService } from '../capability-manifest.service.js';
import { LineageService } from '../../lineage/lineage.service.js';
import { ConnectorProbeService } from '../probe/connector-probe.service.js';
import { KafkaProducerService } from '../../kafka/kafka-producer.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { RoleAssignmentEntity } from '../../organizations/entities/role-assignment.entity.js';
import type { ConnectorType } from '@provenance/types';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const mockRepo = () => ({
  findAndCount: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  count: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
});

const mockProbeService = () => ({
  probe: jest.fn().mockResolvedValue({
    status: 'healthy',
    responseTimeMs: 25,
    errorMessage: null,
  }),
  inferSchema: jest.fn().mockResolvedValue({
    schemaDefinition: { columns: [] },
    columnCount: 0,
    rowEstimate: null,
  }),
  walkDatabricksWorkspace: jest.fn().mockResolvedValue({
    catalogs: [],
    schemasWalked: 0,
    tables: [],
  }),
  walkSnowflakeAccount: jest.fn().mockResolvedValue({
    catalogs: [],
    schemasWalked: 0,
    tables: [],
  }),
  walkDatabricksLineage: jest.fn().mockResolvedValue({
    edges: [],
    tablesWithErrors: [],
  }),
  walkSnowflakeLineage: jest.fn().mockResolvedValue({
    edges: [],
    tablesWithErrors: [],
  }),
});

const mockKafkaProducer = () => ({
  publish: jest.fn().mockResolvedValue(undefined),
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = new Date('2024-01-01T00:00:00Z');

const VALID_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:MyDb-ABCDEF';

const makeConnectorEntity = (
  overrides: Partial<ConnectorEntity> = {},
): ConnectorEntity => ({
  id: 'connector-1',
  orgId: 'org-1',
  domainId: 'domain-1',
  name: 'Orders DB',
  description: null,
  connectorType: 'postgresql' as ConnectorType,
  connectionConfig: { host: 'db.example.com', port: 5432, database: 'orders' },
  credentialArn: VALID_ARN,
  validationStatus: 'pending',
  lastValidatedAt: null,
  createdBy: 'principal-1',
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const makeHealthEventEntity = (): ConnectorHealthEventEntity => ({
  id: 'event-1',
  orgId: 'org-1',
  connectorId: 'connector-1',
  status: 'healthy',
  responseTimeMs: 25,
  errorMessage: null,
  checkedAt: now,
});

const makeSourceEntity = (
  overrides: Partial<SourceRegistrationEntity> = {},
): SourceRegistrationEntity => ({
  id: 'source-1',
  orgId: 'org-1',
  connectorId: 'connector-1',
  sourceRef: 'public.orders',
  sourceType: 'table',
  displayName: 'Orders',
  description: null,
  registeredBy: 'principal-1',
  registeredAt: now,
  updatedAt: now,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConnectorsService', () => {
  let service: ConnectorsService;
  let connectorRepo: ReturnType<typeof mockRepo>;
  let healthEventRepo: ReturnType<typeof mockRepo>;
  let sourceRepo: ReturnType<typeof mockRepo>;
  let snapshotRepo: ReturnType<typeof mockRepo>;
  let crawlEventRepo: ReturnType<typeof mockRepo>;
  let probeService: ReturnType<typeof mockProbeService>;
  let kafkaProducer: ReturnType<typeof mockKafkaProducer>;
  let roleRepo: ReturnType<typeof mockRepo>;
  let lineageService: { emitEvent: jest.Mock };
  let notificationsService: { enqueue: jest.Mock };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ConnectorsService,
        { provide: getRepositoryToken(ConnectorEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(ConnectorHealthEventEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(SourceRegistrationEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(SchemaSnapshotEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(DiscoveryCrawlEventEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(CapabilityManifestEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(RoleAssignmentEntity), useFactory: mockRepo },
        { provide: ConnectorProbeService, useFactory: mockProbeService },
        {
          provide: CapabilityManifestService,
          useValue: {
            // Default: no manifest registered, so auto-crawl on registration
            // never fires. Tests that exercise auto-crawl override this.
            getLatestForType: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: LineageService,
          useValue: {
            // No-op default — discovery-crawl tests that exercise the
            // lineage projection path mock this explicitly.
            emitEvent: jest.fn().mockResolvedValue({ id: 'l1', createdAt: new Date() }),
          },
        },
        { provide: KafkaProducerService, useFactory: mockKafkaProducer },
        {
          provide: NotificationsService,
          useValue: { enqueue: jest.fn().mockResolvedValue([]) },
        },
      ],
    }).compile();

    service = module.get(ConnectorsService);
    connectorRepo = module.get(getRepositoryToken(ConnectorEntity));
    healthEventRepo = module.get(getRepositoryToken(ConnectorHealthEventEntity));
    sourceRepo = module.get(getRepositoryToken(SourceRegistrationEntity));
    snapshotRepo = module.get(getRepositoryToken(SchemaSnapshotEntity));
    crawlEventRepo = module.get(getRepositoryToken(DiscoveryCrawlEventEntity));
    probeService = module.get(ConnectorProbeService);
    kafkaProducer = module.get(KafkaProducerService);
    roleRepo = module.get(getRepositoryToken(RoleAssignmentEntity));
    lineageService = module.get(LineageService);
    notificationsService = module.get(NotificationsService);
  });

  // -------------------------------------------------------------------------
  // registerConnector()
  // -------------------------------------------------------------------------

  describe('registerConnector()', () => {
    const dto = {
      domainId: 'domain-1',
      name: 'Orders DB',
      connectorType: 'postgresql' as ConnectorType,
      connectionConfig: { host: 'db.example.com', port: 5432, database: 'orders' },
      credentialArn: VALID_ARN,
    };

    const setupSaveSuccess = () => {
      connectorRepo.findOne
        .mockResolvedValueOnce(null)   // duplicate check
        .mockResolvedValueOnce(makeConnectorEntity({ validationStatus: 'valid' })); // reload after probe
      const entity = makeConnectorEntity();
      connectorRepo.create.mockReturnValue(entity);
      connectorRepo.save.mockResolvedValue(entity);
      healthEventRepo.create.mockImplementation((d: any) => d);
      healthEventRepo.save.mockResolvedValue(makeHealthEventEntity());
    };

    it('throws BadRequestException when connectionConfig contains a password field', async () => {
      await expect(
        service.registerConnector('org-1', { ...dto, connectionConfig: { host: 'x', password: 'secret' } }, 'p-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when connectionConfig contains an accessKeyId field', async () => {
      await expect(
        service.registerConnector('org-1', { ...dto, connectionConfig: { accessKeyId: 'AKIA...' } }, 'p-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when credentialArn is not a valid ARN', async () => {
      await expect(
        service.registerConnector('org-1', { ...dto, credentialArn: 'notanarn' }, 'p-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when a connector with the same name exists in the domain', async () => {
      connectorRepo.findOne.mockResolvedValue(makeConnectorEntity());

      await expect(
        service.registerConnector('org-1', dto, 'principal-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('persists the connector and runs the live probe on registration', async () => {
      setupSaveSuccess();

      await service.registerConnector('org-1', dto, 'principal-1');

      expect(connectorRepo.save).toHaveBeenCalled();
      expect(probeService.probe).toHaveBeenCalledTimes(1);
    });

    it('records a health event after the probe', async () => {
      setupSaveSuccess();

      await service.registerConnector('org-1', dto, 'principal-1');

      expect(healthEventRepo.save).toHaveBeenCalled();
    });

    it('publishes a ConnectorHealthEventMessage to the connector.health Kafka topic', async () => {
      setupSaveSuccess();

      await service.registerConnector('org-1', dto, 'principal-1');

      expect(kafkaProducer.publish).toHaveBeenCalledWith(
        'connector.health',
        'connector-1',
        expect.objectContaining({
          eventType: 'connector.health_checked',
          schemaVersion: '1.0',
          connectorId: 'connector-1',
          status: 'healthy',
        }),
      );
    });

    it('accepts a null credentialArn for public sources', async () => {
      connectorRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeConnectorEntity({ credentialArn: null, validationStatus: 'valid' }));
      const entity = makeConnectorEntity({ credentialArn: null });
      connectorRepo.create.mockReturnValue(entity);
      connectorRepo.save.mockResolvedValue(entity);
      healthEventRepo.create.mockImplementation((d: any) => d);
      healthEventRepo.save.mockResolvedValue(makeHealthEventEntity());

      const { credentialArn: _credentialArn, ...dtoWithoutArn } = dto;
      const result = await service.registerConnector(
        'org-1',
        dtoWithoutArn,
        'principal-1',
      );
      expect(result).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // validateConnector()
  // -------------------------------------------------------------------------

  describe('validateConnector()', () => {
    it('throws NotFoundException when connector does not exist', async () => {
      connectorRepo.findOne.mockResolvedValue(null);

      await expect(
        service.validateConnector('org-1', 'missing'),
      ).rejects.toThrow(NotFoundException);
    });

    it('runs probe, updates validationStatus to valid, and returns the health event', async () => {
      const entity = makeConnectorEntity();
      connectorRepo.findOne.mockResolvedValue(entity);
      connectorRepo.save.mockResolvedValue(entity);
      healthEventRepo.create.mockImplementation((d: any) => d);
      healthEventRepo.save.mockResolvedValue(makeHealthEventEntity());

      const result = await service.validateConnector('org-1', 'connector-1');

      expect(probeService.probe).toHaveBeenCalledWith(entity);
      expect(connectorRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ validationStatus: 'valid' }),
      );
      expect(result.status).toBe('healthy');
    });

    it('sets validationStatus to invalid when probe fails', async () => {
      probeService.probe.mockResolvedValueOnce({
        status: 'unreachable',
        responseTimeMs: null,
        errorMessage: 'Connection refused',
      });
      const entity = makeConnectorEntity();
      connectorRepo.findOne.mockResolvedValue(entity);
      connectorRepo.save.mockResolvedValue(entity);
      healthEventRepo.create.mockImplementation((d: any) => d);
      healthEventRepo.save.mockResolvedValue({
        ...makeHealthEventEntity(),
        status: 'unreachable',
        errorMessage: 'Connection refused',
      });

      await service.validateConnector('org-1', 'connector-1');

      expect(connectorRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ validationStatus: 'invalid' }),
      );
    });

    it('publishes a health event to Kafka after each validation', async () => {
      connectorRepo.findOne.mockResolvedValue(makeConnectorEntity());
      connectorRepo.save.mockResolvedValue(makeConnectorEntity());
      healthEventRepo.create.mockImplementation((d: any) => d);
      healthEventRepo.save.mockResolvedValue(makeHealthEventEntity());

      await service.validateConnector('org-1', 'connector-1');

      expect(kafkaProducer.publish).toHaveBeenCalledWith(
        'connector.health',
        'connector-1',
        expect.objectContaining({ eventType: 'connector.health_checked' }),
      );
    });

    it('enqueues connector_health_degraded only on transition from valid to invalid (F11.18)', async () => {
      // Probe will return unreachable → newStatus 'invalid'.
      probeService.probe.mockResolvedValueOnce({
        status: 'unreachable',
        responseTimeMs: null,
        errorMessage: 'Connection refused',
      });
      const entity = makeConnectorEntity({ validationStatus: 'valid' });
      connectorRepo.findOne.mockResolvedValue(entity);
      connectorRepo.save.mockResolvedValue(entity);
      healthEventRepo.create.mockImplementation((d: any) => d);
      healthEventRepo.save.mockResolvedValue({
        ...makeHealthEventEntity(),
        status: 'unreachable',
        errorMessage: 'Connection refused',
      });
      roleRepo.find.mockResolvedValue([
        { principalId: 'domain-owner-1' },
        { principalId: 'domain-owner-2' },
      ]);

      await service.validateConnector('org-1', 'connector-1');

      expect(notificationsService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          category: 'connector_health_degraded',
          recipients: ['domain-owner-1', 'domain-owner-2'],
          dedupKey: 'connector_health_degraded:connector-1',
        }),
      );
    });

    it('does not enqueue when the connector was already invalid', async () => {
      probeService.probe.mockResolvedValueOnce({
        status: 'unreachable',
        responseTimeMs: null,
        errorMessage: 'still down',
      });
      const entity = makeConnectorEntity({ validationStatus: 'invalid' });
      connectorRepo.findOne.mockResolvedValue(entity);
      connectorRepo.save.mockResolvedValue(entity);
      healthEventRepo.create.mockImplementation((d: any) => d);
      healthEventRepo.save.mockResolvedValue({
        ...makeHealthEventEntity(),
        status: 'unreachable',
      });

      await service.validateConnector('org-1', 'connector-1');

      expect(notificationsService.enqueue).not.toHaveBeenCalled();
    });

    it('does not enqueue when transition is invalid → valid (recovery is informational only)', async () => {
      // Probe returns healthy. Connector was previously invalid.
      const entity = makeConnectorEntity({ validationStatus: 'invalid' });
      connectorRepo.findOne.mockResolvedValue(entity);
      connectorRepo.save.mockResolvedValue(entity);
      healthEventRepo.create.mockImplementation((d: any) => d);
      healthEventRepo.save.mockResolvedValue(makeHealthEventEntity());

      await service.validateConnector('org-1', 'connector-1');

      expect(notificationsService.enqueue).not.toHaveBeenCalled();
    });

    it('skips the notification when no domain owners are configured', async () => {
      probeService.probe.mockResolvedValueOnce({
        status: 'unreachable',
        responseTimeMs: null,
        errorMessage: 'Down',
      });
      const entity = makeConnectorEntity({ validationStatus: 'valid' });
      connectorRepo.findOne.mockResolvedValue(entity);
      connectorRepo.save.mockResolvedValue(entity);
      healthEventRepo.create.mockImplementation((d: any) => d);
      healthEventRepo.save.mockResolvedValue({
        ...makeHealthEventEntity(),
        status: 'unreachable',
      });
      roleRepo.find.mockResolvedValue([]);

      await service.validateConnector('org-1', 'connector-1');

      expect(notificationsService.enqueue).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // deleteConnector()
  // -------------------------------------------------------------------------

  describe('deleteConnector()', () => {
    it('throws NotFoundException when connector does not exist', async () => {
      connectorRepo.findOne.mockResolvedValue(null);

      await expect(
        service.deleteConnector('org-1', 'missing'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when source registrations exist', async () => {
      connectorRepo.findOne.mockResolvedValue(makeConnectorEntity());
      sourceRepo.count.mockResolvedValue(2);

      await expect(
        service.deleteConnector('org-1', 'connector-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('deletes the connector when no source registrations exist', async () => {
      connectorRepo.findOne.mockResolvedValue(makeConnectorEntity());
      sourceRepo.count.mockResolvedValue(0);
      connectorRepo.remove.mockResolvedValue(undefined);

      await expect(
        service.deleteConnector('org-1', 'connector-1'),
      ).resolves.toBeUndefined();
      expect(connectorRepo.remove).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // updateConnector()
  // -------------------------------------------------------------------------

  describe('updateConnector()', () => {
    it('marks validationStatus as stale when connectionConfig changes', async () => {
      connectorRepo.findOne.mockResolvedValue(makeConnectorEntity());
      connectorRepo.save.mockImplementation((e: any) => Promise.resolve(e));

      await service.updateConnector('org-1', 'connector-1', {
        connectionConfig: { host: 'new-db.example.com' },
      });

      expect(connectorRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ validationStatus: 'stale' }),
      );
    });

    it('throws BadRequestException when new connectionConfig contains raw credentials', async () => {
      connectorRepo.findOne.mockResolvedValue(makeConnectorEntity());

      await expect(
        service.updateConnector('org-1', 'connector-1', {
          connectionConfig: { host: 'x', password: 'secret' },
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // -------------------------------------------------------------------------
  // registerSource()
  // -------------------------------------------------------------------------

  describe('registerSource()', () => {
    it('throws NotFoundException when connector does not exist', async () => {
      connectorRepo.findOne.mockResolvedValue(null);

      await expect(
        service.registerSource('org-1', 'missing', {
          sourceRef: 'public.orders',
          sourceType: 'table',
          displayName: 'Orders',
        }, 'p-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException on duplicate source_ref within the connector', async () => {
      connectorRepo.findOne.mockResolvedValue(makeConnectorEntity());
      sourceRepo.findOne.mockResolvedValue(makeSourceEntity());

      await expect(
        service.registerSource('org-1', 'connector-1', {
          sourceRef: 'public.orders',
          sourceType: 'table',
          displayName: 'Orders',
        }, 'p-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('creates and returns the source registration', async () => {
      connectorRepo.findOne.mockResolvedValue(makeConnectorEntity());
      sourceRepo.findOne.mockResolvedValue(null);
      sourceRepo.create.mockImplementation((d: any) => d);
      sourceRepo.save.mockResolvedValue(makeSourceEntity());

      const result = await service.registerSource(
        'org-1',
        'connector-1',
        { sourceRef: 'public.orders', sourceType: 'table', displayName: 'Orders' },
        'p-1',
      );

      expect(result.sourceRef).toBe('public.orders');
    });
  });

  // -------------------------------------------------------------------------
  // captureSchemaSnapshot()
  // -------------------------------------------------------------------------

  describe('captureSchemaSnapshot()', () => {
    it('throws NotFoundException when connector does not exist', async () => {
      connectorRepo.findOne.mockResolvedValue(null);
      sourceRepo.findOne.mockResolvedValue(makeSourceEntity());

      await expect(
        service.captureSchemaSnapshot('org-1', 'missing', 'source-1', 'p-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when source registration does not exist', async () => {
      connectorRepo.findOne.mockResolvedValue(makeConnectorEntity());
      sourceRepo.findOne.mockResolvedValue(null);

      await expect(
        service.captureSchemaSnapshot('org-1', 'connector-1', 'missing', 'p-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('calls inferSchema and persists an immutable snapshot', async () => {
      probeService.inferSchema.mockResolvedValueOnce({
        schemaDefinition: { columns: [{ name: 'id', type: 'uuid' }] },
        columnCount: 1,
        rowEstimate: 1000,
      });
      connectorRepo.findOne.mockResolvedValue(makeConnectorEntity());
      sourceRepo.findOne.mockResolvedValue(makeSourceEntity());
      snapshotRepo.create.mockImplementation((d: any) => d);
      snapshotRepo.save.mockResolvedValue({
        id: 'snap-1',
        orgId: 'org-1',
        sourceRegistrationId: 'source-1',
        connectorId: 'connector-1',
        schemaDefinition: { columns: [{ name: 'id', type: 'uuid' }] },
        columnCount: 1,
        rowEstimate: 1000,
        capturedBy: 'p-1',
        capturedAt: now,
      });

      const result = await service.captureSchemaSnapshot(
        'org-1', 'connector-1', 'source-1', 'p-1',
      );

      expect(probeService.inferSchema).toHaveBeenCalled();
      expect(snapshotRepo.save).toHaveBeenCalled();
      expect(result.columnCount).toBe(1);
      expect(result.rowEstimate).toBe(1000);
    });
  });

  // -------------------------------------------------------------------------
  // crawlConnector() — Snowflake (B-063 Layer 3)
  // -------------------------------------------------------------------------

  describe('crawlConnector() — snowflake', () => {
    const snowflakeConnector = makeConnectorEntity({
      id: 'sf-connector-1',
      connectorType: 'snowflake' as ConnectorType,
      connectionConfig: {
        host: 'xy12345.us-east-1.snowflakecomputing.com',
        warehouse: 'COMPUTE_WH',
        role: 'ACCOUNTADMIN',
      },
      credentialArn: VALID_ARN,
    });

    const discoveredTable = {
      catalog: 'PROVENANCE_DEMO',
      schema: 'SALES',
      name: 'CUSTOMERS',
      fullName: 'PROVENANCE_DEMO.SALES.CUSTOMERS',
    };

    function setupCrawlMocks(tables: typeof discoveredTable[]) {
      connectorRepo.findOne.mockResolvedValue(snowflakeConnector);

      // crawlEventRepo: create returns an entity; save returns the same (running),
      // then the final completed state.
      const runningEvent = {
        id: 'crawl-1',
        orgId: 'org-1',
        connectorId: 'sf-connector-1',
        triggeredBy: 'principal-1',
        status: 'running',
        startedAt: new Date('2024-01-01T00:00:00Z'),
        completedAt: null,
        catalogsWalked: 0,
        schemasWalked: 0,
        tablesFound: 0,
        sourcesCreated: 0,
        sourcesSkipped: 0,
        snapshotsCaptured: 0,
        snapshotsFailed: 0,
        lineageEdgesEmitted: 0,
        lineageEdgesSkipped: 0,
        lineageEdgesFailed: 0,
        metadata: {},
        errorMessage: null,
      };
      crawlEventRepo.create.mockReturnValue(runningEvent);
      crawlEventRepo.save
        .mockResolvedValueOnce(runningEvent) // initial save (running)
        .mockImplementationOnce((e: any) => Promise.resolve(e)); // final save — returns the mutated entity as-is

      probeService.walkSnowflakeAccount.mockResolvedValue({
        catalogs: tables.length > 0 ? ['PROVENANCE_DEMO'] : [],
        schemasWalked: tables.length > 0 ? 1 : 0,
        tables,
      });

      // Each table: sourceRepo.findOne → null (new), save returns entity.
      for (const table of tables) {
        sourceRepo.findOne.mockResolvedValueOnce(null);
        const sourceEntity = makeSourceEntity({
          id: `source-${table.name}`,
          sourceRef: table.fullName,
          connectorId: 'sf-connector-1',
        });
        sourceRepo.create.mockReturnValueOnce(sourceEntity);
        sourceRepo.save.mockResolvedValueOnce(sourceEntity);
        snapshotRepo.create.mockReturnValueOnce({ id: `snap-${table.name}` });
        snapshotRepo.save.mockResolvedValueOnce({ id: `snap-${table.name}` });
      }
    }

    it('throws BadRequestException when connector is not found', async () => {
      connectorRepo.findOne.mockResolvedValue(null);

      await expect(
        service.crawlConnector('org-1', 'missing-id', 'principal-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for unsupported connector types', async () => {
      // postgresql is not in the allowed set (only databricks and snowflake).
      // The gate fires before the crawl event is created, so no repo setup needed.
      connectorRepo.findOne.mockResolvedValue(makeConnectorEntity({ connectorType: 'postgresql' as ConnectorType }));

      await expect(
        service.crawlConnector('org-1', 'connector-1', 'principal-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('walks the Snowflake account via walkSnowflakeAccount, creates sources and snapshots', async () => {
      setupCrawlMocks([discoveredTable]);

      const result = await service.crawlConnector('org-1', 'sf-connector-1', 'principal-1');

      expect(probeService.walkSnowflakeAccount).toHaveBeenCalledWith(
        snowflakeConnector,
        undefined, // no databases scope on the connector config
      );
      expect(result.status).toBe('succeeded');
      expect(result.tablesFound).toBe(1);
      expect(result.sourcesCreated).toBe(1);
      expect(result.snapshotsCaptured).toBe(1);
    });

    it('passes databases scope from connectionConfig.databases to walkSnowflakeAccount', async () => {
      const scopedConnector = makeConnectorEntity({
        id: 'sf-connector-1',
        connectorType: 'snowflake' as ConnectorType,
        connectionConfig: {
          host: 'xy12345.us-east-1.snowflakecomputing.com',
          databases: ['PROVENANCE_DEMO'],
        },
        credentialArn: VALID_ARN,
      });
      connectorRepo.findOne.mockResolvedValue(scopedConnector);

      const runningEvent = {
        id: 'crawl-scoped',
        orgId: 'org-1',
        connectorId: 'sf-connector-1',
        triggeredBy: 'principal-1',
        status: 'running',
        startedAt: new Date(),
        completedAt: null,
        metadata: {},
      };
      crawlEventRepo.create.mockReturnValue(runningEvent);
      crawlEventRepo.save.mockImplementation((e: any) => Promise.resolve(e));
      probeService.walkSnowflakeAccount.mockResolvedValue({
        catalogs: ['PROVENANCE_DEMO'],
        schemasWalked: 0,
        tables: [],
      });

      await service.crawlConnector('org-1', 'sf-connector-1', 'principal-1');

      expect(probeService.walkSnowflakeAccount).toHaveBeenCalledWith(
        scopedConnector,
        ['PROVENANCE_DEMO'],
      );
    });

    it('does NOT call walkDatabricksWorkspace or walkDatabricksLineage for a snowflake crawl', async () => {
      setupCrawlMocks([discoveredTable]);

      await service.crawlConnector('org-1', 'sf-connector-1', 'principal-1');

      expect(probeService.walkDatabricksWorkspace).not.toHaveBeenCalled();
      expect(probeService.walkDatabricksLineage).not.toHaveBeenCalled();
    });

    it('returns lineage counts of 0 on a snowflake crawl when there are no tables', async () => {
      setupCrawlMocks([]);

      const result = await service.crawlConnector('org-1', 'sf-connector-1', 'principal-1');

      expect(result.metadata).toMatchObject({
        lineageEdgesEmitted: 0,
        lineageEdgesSkipped: 0,
        lineageEdgesFailed: 0,
        tablesWithLineageErrors: [],
      });
    });

    // ---- Layer 4 lineage projection tests ----

    it('calls walkSnowflakeLineage with the discovered fullNames and emits each edge via lineageService.emitEvent', async () => {
      setupCrawlMocks([
        discoveredTable,
        { catalog: 'PROVENANCE_DEMO', schema: 'SALES', name: 'ORDERS', fullName: 'PROVENANCE_DEMO.SALES.ORDERS' },
        { catalog: 'PROVENANCE_DEMO', schema: 'SALES', name: 'CUSTOMER_ORDER_SUMMARY', fullName: 'PROVENANCE_DEMO.SALES.CUSTOMER_ORDER_SUMMARY' },
      ]);

      const edge1 = {
        sourceFullName: 'PROVENANCE_DEMO.SALES.CUSTOMERS',
        targetFullName: 'PROVENANCE_DEMO.SALES.CUSTOMER_ORDER_SUMMARY',
      };
      const edge2 = {
        sourceFullName: 'PROVENANCE_DEMO.SALES.ORDERS',
        targetFullName: 'PROVENANCE_DEMO.SALES.CUSTOMER_ORDER_SUMMARY',
      };
      probeService.walkSnowflakeLineage.mockResolvedValue({
        edges: [edge1, edge2],
        tablesWithErrors: [],
      });
      // Two new lineage rows (createdAt AFTER the crawl start).
      lineageService.emitEvent
        .mockResolvedValueOnce({ id: 'l1', createdAt: new Date('2025-01-01T01:00:00Z') })
        .mockResolvedValueOnce({ id: 'l2', createdAt: new Date('2025-01-01T01:00:00Z') });

      const result = await service.crawlConnector('org-1', 'sf-connector-1', 'principal-1');

      expect(probeService.walkSnowflakeLineage).toHaveBeenCalledWith(
        snowflakeConnector,
        expect.arrayContaining([
          'PROVENANCE_DEMO.SALES.CUSTOMERS',
          'PROVENANCE_DEMO.SALES.ORDERS',
          'PROVENANCE_DEMO.SALES.CUSTOMER_ORDER_SUMMARY',
        ]),
      );
      expect(lineageService.emitEvent).toHaveBeenCalledTimes(2);
      expect(result.metadata).toMatchObject({
        lineageEdgesEmitted: 2,
        lineageEdgesSkipped: 0,
        lineageEdgesFailed: 0,
        tablesWithLineageErrors: [],
      });
    });

    it('emitEvent is called with the correct node_ids, connectorType=snowflake metadata, and deterministic idempotency key', async () => {
      setupCrawlMocks([
        discoveredTable,
        { catalog: 'PROVENANCE_DEMO', schema: 'SALES', name: 'CUSTOMER_ORDER_SUMMARY', fullName: 'PROVENANCE_DEMO.SALES.CUSTOMER_ORDER_SUMMARY' },
      ]);

      const edge = {
        sourceFullName: 'PROVENANCE_DEMO.SALES.CUSTOMERS',
        targetFullName: 'PROVENANCE_DEMO.SALES.CUSTOMER_ORDER_SUMMARY',
      };
      probeService.walkSnowflakeLineage.mockResolvedValue({ edges: [edge], tablesWithErrors: [] });
      lineageService.emitEvent.mockResolvedValue({ id: 'l1', createdAt: new Date('2025-01-01T01:00:00Z') });

      await service.crawlConnector('org-1', 'sf-connector-1', 'principal-1');

      expect(lineageService.emitEvent).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({
          source_node: expect.objectContaining({
            node_type: 'Source',
            node_id: 'PROVENANCE_DEMO.SALES.CUSTOMERS',
            org_id: 'org-1',
            display_name: 'PROVENANCE_DEMO.SALES.CUSTOMERS',
            metadata: { connectorType: 'snowflake' },
          }),
          target_node: expect.objectContaining({
            node_type: 'Source',
            node_id: 'PROVENANCE_DEMO.SALES.CUSTOMER_ORDER_SUMMARY',
            org_id: 'org-1',
            display_name: 'PROVENANCE_DEMO.SALES.CUSTOMER_ORDER_SUMMARY',
            metadata: { connectorType: 'snowflake' },
          }),
          edge_type: 'DERIVES_FROM',
          emitted_by: 'snowflake-discovery-crawl',
          confidence: 1.0,
          idempotency_key: 'snowflake-lineage:sf-connector-1:PROVENANCE_DEMO.SALES.CUSTOMERS->PROVENANCE_DEMO.SALES.CUSTOMER_ORDER_SUMMARY',
        }),
      );
    });

    it('counts idempotency hits (pre-crawl createdAt) as skipped, not emitted', async () => {
      setupCrawlMocks([
        discoveredTable,
        { catalog: 'PROVENANCE_DEMO', schema: 'SALES', name: 'CUSTOMER_ORDER_SUMMARY', fullName: 'PROVENANCE_DEMO.SALES.CUSTOMER_ORDER_SUMMARY' },
      ]);

      probeService.walkSnowflakeLineage.mockResolvedValue({
        edges: [{ sourceFullName: 'PROVENANCE_DEMO.SALES.CUSTOMERS', targetFullName: 'PROVENANCE_DEMO.SALES.CUSTOMER_ORDER_SUMMARY' }],
        tablesWithErrors: [],
      });
      // Return a createdAt that is BEFORE the crawl event's startedAt (2024-01-01T00:00:00Z)
      // → idempotency hit = skipped.
      lineageService.emitEvent.mockResolvedValue({ id: 'l1', createdAt: new Date('2023-12-31T00:00:00Z') });

      const result = await service.crawlConnector('org-1', 'sf-connector-1', 'principal-1');

      expect(result.metadata).toMatchObject({
        lineageEdgesEmitted: 0,
        lineageEdgesSkipped: 1,
        lineageEdgesFailed: 0,
      });
    });

    it('records lineageEdgesFailed when emitEvent throws and continues processing remaining edges', async () => {
      setupCrawlMocks([
        discoveredTable,
        { catalog: 'PROVENANCE_DEMO', schema: 'SALES', name: 'ORDERS', fullName: 'PROVENANCE_DEMO.SALES.ORDERS' },
        { catalog: 'PROVENANCE_DEMO', schema: 'SALES', name: 'CUSTOMER_ORDER_SUMMARY', fullName: 'PROVENANCE_DEMO.SALES.CUSTOMER_ORDER_SUMMARY' },
      ]);

      probeService.walkSnowflakeLineage.mockResolvedValue({
        edges: [
          { sourceFullName: 'PROVENANCE_DEMO.SALES.CUSTOMERS', targetFullName: 'PROVENANCE_DEMO.SALES.CUSTOMER_ORDER_SUMMARY' },
          { sourceFullName: 'PROVENANCE_DEMO.SALES.ORDERS', targetFullName: 'PROVENANCE_DEMO.SALES.CUSTOMER_ORDER_SUMMARY' },
        ],
        tablesWithErrors: [],
      });
      lineageService.emitEvent
        .mockRejectedValueOnce(new Error('Neo4j timeout'))
        .mockResolvedValueOnce({ id: 'l2', createdAt: new Date('2025-01-01T01:00:00Z') });

      const result = await service.crawlConnector('org-1', 'sf-connector-1', 'principal-1');

      // One failed, one emitted.
      expect(result.metadata).toMatchObject({
        lineageEdgesEmitted: 1,
        lineageEdgesFailed: 1,
      });
    });

    it('gracefully handles walkSnowflakeLineage throwing (degraded crawl, not failed)', async () => {
      setupCrawlMocks([discoveredTable]);
      probeService.walkSnowflakeLineage.mockRejectedValue(new Error('ACCOUNT_USAGE locked'));

      const result = await service.crawlConnector('org-1', 'sf-connector-1', 'principal-1');

      // Crawl completes (succeeded or partial), lineage counts are all 0.
      expect(['succeeded', 'partial']).toContain(result.status);
      expect(lineageService.emitEvent).not.toHaveBeenCalled();
      expect(result.metadata).toMatchObject({
        lineageEdgesEmitted: 0,
        lineageEdgesFailed: 0,
      });
    });

    it('skips already-registered sources and does not create duplicates', async () => {
      connectorRepo.findOne.mockResolvedValue(snowflakeConnector);

      const runningEvent = {
        id: 'crawl-skip',
        orgId: 'org-1',
        connectorId: 'sf-connector-1',
        triggeredBy: 'principal-1',
        status: 'running',
        startedAt: new Date(),
        completedAt: null,
        metadata: {},
      };
      crawlEventRepo.create.mockReturnValue(runningEvent);
      crawlEventRepo.save.mockImplementation((e: any) => Promise.resolve(e));

      probeService.walkSnowflakeAccount.mockResolvedValue({
        catalogs: ['PROVENANCE_DEMO'],
        schemasWalked: 1,
        tables: [discoveredTable],
      });
      // Source already exists → findOne returns an entity (not null).
      sourceRepo.findOne.mockResolvedValue(makeSourceEntity({ sourceRef: discoveredTable.fullName }));

      const result = await service.crawlConnector('org-1', 'sf-connector-1', 'principal-1');

      expect(sourceRepo.save).not.toHaveBeenCalled(); // no new source
      expect(result.sourcesSkipped).toBe(1);
    });
  });
});
