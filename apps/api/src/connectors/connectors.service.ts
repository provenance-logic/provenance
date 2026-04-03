import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { ConnectorEntity } from './entities/connector.entity.js';
import { ConnectorHealthEventEntity } from './entities/connector-health-event.entity.js';
import { SourceRegistrationEntity } from './entities/source-registration.entity.js';
import { SchemaSnapshotEntity } from './entities/schema-snapshot.entity.js';
import { ConnectorProbeService } from './probe/connector-probe.service.js';
import { detectRawCredentialKey, isValidCredentialArn } from './probe/raw-credential-guard.js';
import { KafkaProducerService } from '../kafka/kafka-producer.service.js';
import type {
  Connector,
  ConnectorList,
  RegisterConnectorRequest,
  UpdateConnectorRequest,
  ValidationStatus,
  ConnectorHealthEvent,
  ConnectorHealthEventList,
  SourceRegistration,
  SourceRegistrationList,
  RegisterSourceRequest,
  UpdateSourceRequest,
  SourceType,
  SchemaSnapshot,
  SchemaSnapshotList,
  ConnectorHealthEventMessage,
} from '@provenance/types';

@Injectable()
export class ConnectorsService {
  constructor(
    @InjectRepository(ConnectorEntity)
    private readonly connectorRepo: Repository<ConnectorEntity>,
    @InjectRepository(ConnectorHealthEventEntity)
    private readonly healthEventRepo: Repository<ConnectorHealthEventEntity>,
    @InjectRepository(SourceRegistrationEntity)
    private readonly sourceRepo: Repository<SourceRegistrationEntity>,
    @InjectRepository(SchemaSnapshotEntity)
    private readonly snapshotRepo: Repository<SchemaSnapshotEntity>,
    private readonly probeService: ConnectorProbeService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  // ---------------------------------------------------------------------------
  // Connectors
  // ---------------------------------------------------------------------------

  async listConnectors(
    orgId: string,
    limit: number,
    offset: number,
    domainId?: string,
    validationStatus?: ValidationStatus,
  ): Promise<ConnectorList> {
    const where: Record<string, unknown> = { orgId };
    if (domainId) where.domainId = domainId;
    if (validationStatus) where.validationStatus = validationStatus;
    const [items, total] = await this.connectorRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return {
      items: items.map((i) => this.toConnector(i)),
      meta: { total, limit, offset },
    };
  }

  async registerConnector(
    orgId: string,
    dto: RegisterConnectorRequest,
    createdBy: string,
  ): Promise<Connector> {
    // 1. Reject raw credentials in connectionConfig
    const badKey = detectRawCredentialKey(dto.connectionConfig ?? {});
    if (badKey) {
      throw new BadRequestException(
        `connectionConfig must not contain raw credentials. ` +
          `Detected suspicious field: '${badKey}'. ` +
          `Store credentials in AWS Secrets Manager and provide the ARN via credentialArn.`,
      );
    }

    // 2. Validate credentialArn format if provided
    if (dto.credentialArn && !isValidCredentialArn(dto.credentialArn)) {
      throw new BadRequestException(
        `credentialArn does not appear to be a valid AWS Secrets Manager ARN: '${dto.credentialArn}'`,
      );
    }

    // 3. Duplicate name check within (org, domain)
    const existing = await this.connectorRepo.findOne({
      where: { orgId, domainId: dto.domainId, name: dto.name },
    });
    if (existing) {
      throw new ConflictException(
        `A connector named '${dto.name}' already exists in this domain`,
      );
    }

    // 4. Persist with status=pending
    const connector = await this.connectorRepo.save(
      this.connectorRepo.create({
        orgId,
        domainId: dto.domainId,
        name: dto.name,
        description: dto.description ?? null,
        connectorType: dto.connectorType,
        connectionConfig: dto.connectionConfig ?? {},
        credentialArn: dto.credentialArn ?? null,
        validationStatus: 'pending',
        createdBy,
      }),
    );

    // 5. Run live probe, record health event, update validation_status
    await this.runProbeAndRecord(connector);

    const updated = await this.connectorRepo.findOne({
      where: { id: connector.id, orgId },
    });
    return this.toConnector(updated!);
  }

  async getConnector(orgId: string, connectorId: string): Promise<Connector> {
    const connector = await this.connectorRepo.findOne({
      where: { id: connectorId, orgId },
    });
    if (!connector) throw new NotFoundException(`Connector ${connectorId} not found`);
    return this.toConnector(connector);
  }

  async updateConnector(
    orgId: string,
    connectorId: string,
    dto: UpdateConnectorRequest,
  ): Promise<Connector> {
    const connector = await this.connectorRepo.findOne({
      where: { id: connectorId, orgId },
    });
    if (!connector) throw new NotFoundException(`Connector ${connectorId} not found`);

    if (dto.connectionConfig !== undefined) {
      const badKey = detectRawCredentialKey(dto.connectionConfig);
      if (badKey) {
        throw new BadRequestException(
          `connectionConfig must not contain raw credentials. Detected: '${badKey}'`,
        );
      }
      connector.connectionConfig = dto.connectionConfig;
    }
    if (dto.credentialArn !== undefined) {
      if (dto.credentialArn && !isValidCredentialArn(dto.credentialArn)) {
        throw new BadRequestException(
          `credentialArn is not a valid Secrets Manager ARN: '${dto.credentialArn}'`,
        );
      }
      connector.credentialArn = dto.credentialArn ?? null;
    }
    if (dto.name !== undefined) connector.name = dto.name;
    if (dto.description !== undefined) connector.description = dto.description ?? null;

    // Credential or config changes invalidate previous validation.
    if (dto.connectionConfig !== undefined || dto.credentialArn !== undefined) {
      connector.validationStatus = 'stale';
    }

    const saved = await this.connectorRepo.save(connector);
    return this.toConnector(saved);
  }

  async deleteConnector(orgId: string, connectorId: string): Promise<void> {
    const connector = await this.connectorRepo.findOne({
      where: { id: connectorId, orgId },
    });
    if (!connector) throw new NotFoundException(`Connector ${connectorId} not found`);

    const sourceCount = await this.sourceRepo.count({
      where: { connectorId, orgId },
    });
    if (sourceCount > 0) {
      throw new ConflictException(
        `Cannot delete connector ${connectorId}: ${sourceCount} source registration(s) exist. Delete sources first.`,
      );
    }

    await this.connectorRepo.remove(connector);
  }

  async validateConnector(
    orgId: string,
    connectorId: string,
  ): Promise<ConnectorHealthEvent> {
    const connector = await this.connectorRepo.findOne({
      where: { id: connectorId, orgId },
    });
    if (!connector) throw new NotFoundException(`Connector ${connectorId} not found`);
    return this.runProbeAndRecord(connector);
  }

  // ---------------------------------------------------------------------------
  // Health Events
  // ---------------------------------------------------------------------------

  async listHealthEvents(
    orgId: string,
    connectorId: string,
    limit: number,
    offset: number,
  ): Promise<ConnectorHealthEventList> {
    // Verify connector belongs to org
    const exists = await this.connectorRepo.findOne({
      where: { id: connectorId, orgId },
    });
    if (!exists) throw new NotFoundException(`Connector ${connectorId} not found`);

    const [items, total] = await this.healthEventRepo.findAndCount({
      where: { connectorId, orgId },
      order: { checkedAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return {
      items: items.map((i) => this.toHealthEvent(i)),
      meta: { total, limit, offset },
    };
  }

  // ---------------------------------------------------------------------------
  // Source Registrations
  // ---------------------------------------------------------------------------

  async listSourceRegistrations(
    orgId: string,
    connectorId: string,
    limit: number,
    offset: number,
    sourceType?: SourceType,
  ): Promise<SourceRegistrationList> {
    const exists = await this.connectorRepo.findOne({
      where: { id: connectorId, orgId },
    });
    if (!exists) throw new NotFoundException(`Connector ${connectorId} not found`);

    const where: Record<string, unknown> = { connectorId, orgId };
    if (sourceType) where.sourceType = sourceType;
    const [items, total] = await this.sourceRepo.findAndCount({
      where,
      order: { registeredAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return {
      items: items.map((i) => this.toSourceRegistration(i)),
      meta: { total, limit, offset },
    };
  }

  async registerSource(
    orgId: string,
    connectorId: string,
    dto: RegisterSourceRequest,
    registeredBy: string,
  ): Promise<SourceRegistration> {
    const connector = await this.connectorRepo.findOne({
      where: { id: connectorId, orgId },
    });
    if (!connector) throw new NotFoundException(`Connector ${connectorId} not found`);

    const duplicate = await this.sourceRepo.findOne({
      where: { connectorId, sourceRef: dto.sourceRef },
    });
    if (duplicate) {
      throw new ConflictException(
        `Source '${dto.sourceRef}' is already registered for this connector`,
      );
    }

    const source = await this.sourceRepo.save(
      this.sourceRepo.create({
        orgId,
        connectorId,
        sourceRef: dto.sourceRef,
        sourceType: dto.sourceType,
        displayName: dto.displayName,
        description: dto.description ?? null,
        registeredBy,
      }),
    );
    return this.toSourceRegistration(source);
  }

  async getSourceRegistration(
    orgId: string,
    connectorId: string,
    sourceId: string,
  ): Promise<SourceRegistration> {
    const source = await this.sourceRepo.findOne({
      where: { id: sourceId, connectorId, orgId },
    });
    if (!source) throw new NotFoundException(`Source registration ${sourceId} not found`);
    return this.toSourceRegistration(source);
  }

  async updateSourceRegistration(
    orgId: string,
    connectorId: string,
    sourceId: string,
    dto: UpdateSourceRequest,
  ): Promise<SourceRegistration> {
    const source = await this.sourceRepo.findOne({
      where: { id: sourceId, connectorId, orgId },
    });
    if (!source) throw new NotFoundException(`Source registration ${sourceId} not found`);
    if (dto.displayName !== undefined) source.displayName = dto.displayName;
    if (dto.description !== undefined) source.description = dto.description ?? null;
    const saved = await this.sourceRepo.save(source);
    return this.toSourceRegistration(saved);
  }

  async deleteSourceRegistration(
    orgId: string,
    connectorId: string,
    sourceId: string,
  ): Promise<void> {
    const source = await this.sourceRepo.findOne({
      where: { id: sourceId, connectorId, orgId },
    });
    if (!source) throw new NotFoundException(`Source registration ${sourceId} not found`);
    await this.sourceRepo.remove(source);
  }

  // ---------------------------------------------------------------------------
  // Schema Snapshots
  // ---------------------------------------------------------------------------

  async listSchemaSnapshots(
    orgId: string,
    connectorId: string,
    sourceId: string,
    limit: number,
    offset: number,
  ): Promise<SchemaSnapshotList> {
    const source = await this.sourceRepo.findOne({
      where: { id: sourceId, connectorId, orgId },
    });
    if (!source) throw new NotFoundException(`Source registration ${sourceId} not found`);

    const [items, total] = await this.snapshotRepo.findAndCount({
      where: { sourceRegistrationId: sourceId, connectorId, orgId },
      order: { capturedAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return {
      items: items.map((i) => this.toSchemaSnapshot(i)),
      meta: { total, limit, offset },
    };
  }

  async captureSchemaSnapshot(
    orgId: string,
    connectorId: string,
    sourceId: string,
    capturedBy: string | null,
  ): Promise<SchemaSnapshot> {
    const [connector, source] = await Promise.all([
      this.connectorRepo.findOne({ where: { id: connectorId, orgId } }),
      this.sourceRepo.findOne({ where: { id: sourceId, connectorId, orgId } }),
    ]);
    if (!connector) throw new NotFoundException(`Connector ${connectorId} not found`);
    if (!source) throw new NotFoundException(`Source registration ${sourceId} not found`);

    const inferred = await this.probeService.inferSchema(connector, source);

    const snapshot = await this.snapshotRepo.save(
      this.snapshotRepo.create({
        orgId,
        sourceRegistrationId: sourceId,
        connectorId,
        schemaDefinition: inferred.schemaDefinition,
        columnCount: inferred.columnCount,
        rowEstimate: inferred.rowEstimate,
        capturedBy,
      }),
    );
    return this.toSchemaSnapshot(snapshot);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Runs the live probe, persists the health event, updates connector
   * validationStatus + lastValidatedAt, and publishes to Kafka.
   */
  private async runProbeAndRecord(
    connector: ConnectorEntity,
  ): Promise<ConnectorHealthEvent> {
    const result = await this.probeService.probe(connector);

    const healthEvent = await this.healthEventRepo.save(
      this.healthEventRepo.create({
        orgId: connector.orgId,
        connectorId: connector.id,
        status: result.status,
        responseTimeMs: result.responseTimeMs,
        errorMessage: result.errorMessage,
      }),
    );

    // valid if healthy or degraded; invalid otherwise
    const newStatus: ValidationStatus =
      result.status === 'healthy' || result.status === 'degraded'
        ? 'valid'
        : 'invalid';
    connector.validationStatus = newStatus;
    connector.lastValidatedAt = healthEvent.checkedAt;
    await this.connectorRepo.save(connector);

    const message: ConnectorHealthEventMessage = {
      eventId: randomUUID(),
      schemaVersion: '1.0',
      eventType: 'connector.health_checked',
      orgId: connector.orgId,
      connectorId: connector.id,
      domainId: connector.domainId,
      status: result.status,
      responseTimeMs: result.responseTimeMs,
      errorMessage: result.errorMessage,
      checkedAt: healthEvent.checkedAt.toISOString(),
    };
    await this.kafkaProducer.publish('connector.health', connector.id, message);

    return this.toHealthEvent(healthEvent);
  }

  // ---------------------------------------------------------------------------
  // Mappers
  // ---------------------------------------------------------------------------

  private toConnector(e: ConnectorEntity): Connector {
    return {
      id: e.id,
      orgId: e.orgId,
      domainId: e.domainId,
      name: e.name,
      description: e.description,
      connectorType: e.connectorType,
      connectionConfig: e.connectionConfig,
      credentialArn: e.credentialArn,
      validationStatus: e.validationStatus,
      lastValidatedAt: e.lastValidatedAt ? e.lastValidatedAt.toISOString() : null,
      createdBy: e.createdBy,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    };
  }

  private toHealthEvent(e: ConnectorHealthEventEntity): ConnectorHealthEvent {
    return {
      id: e.id,
      orgId: e.orgId,
      connectorId: e.connectorId,
      status: e.status,
      responseTimeMs: e.responseTimeMs,
      errorMessage: e.errorMessage,
      checkedAt: e.checkedAt.toISOString(),
    };
  }

  private toSourceRegistration(e: SourceRegistrationEntity): SourceRegistration {
    return {
      id: e.id,
      orgId: e.orgId,
      connectorId: e.connectorId,
      sourceRef: e.sourceRef,
      sourceType: e.sourceType,
      displayName: e.displayName,
      description: e.description,
      registeredBy: e.registeredBy,
      registeredAt: e.registeredAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    };
  }

  private toSchemaSnapshot(e: SchemaSnapshotEntity): SchemaSnapshot {
    return {
      id: e.id,
      orgId: e.orgId,
      sourceRegistrationId: e.sourceRegistrationId,
      connectorId: e.connectorId,
      schemaDefinition: e.schemaDefinition,
      columnCount: e.columnCount,
      rowEstimate: e.rowEstimate,
      capturedBy: e.capturedBy,
      capturedAt: e.capturedAt.toISOString(),
    };
  }
}
