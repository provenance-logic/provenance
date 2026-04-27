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
  let probeService: ReturnType<typeof mockProbeService>;
  let kafkaProducer: ReturnType<typeof mockKafkaProducer>;
  let roleRepo: ReturnType<typeof mockRepo>;
  let notificationsService: { enqueue: jest.Mock };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ConnectorsService,
        { provide: getRepositoryToken(ConnectorEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(ConnectorHealthEventEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(SourceRegistrationEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(SchemaSnapshotEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(RoleAssignmentEntity), useFactory: mockRepo },
        { provide: ConnectorProbeService, useFactory: mockProbeService },
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
    probeService = module.get(ConnectorProbeService);
    kafkaProducer = module.get(KafkaProducerService);
    roleRepo = module.get(getRepositoryToken(RoleAssignmentEntity));
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
});
