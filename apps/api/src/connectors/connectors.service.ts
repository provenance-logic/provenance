import {
  Injectable,
  Logger,
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
import {
  DiscoveryCrawlEventEntity,
  type DiscoveryCrawlStatus,
} from './entities/discovery-crawl-event.entity.js';
import { CapabilityManifestService } from './capability-manifest.service.js';
import { LineageService } from '../lineage/lineage.service.js';
import { ConnectorProbeService } from './probe/connector-probe.service.js';
import { detectRawCredentialKey, isValidCredentialArn } from './probe/raw-credential-guard.js';
import { KafkaProducerService } from '../kafka/kafka-producer.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RoleAssignmentEntity } from '../organizations/entities/role-assignment.entity.js';
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

// Layer 3a (B-063): operator-facing record of a single crawl invocation.
// Promote to packages/types in the follow-up PR that adds the OpenAPI spec
// for the crawl endpoints.
export interface DiscoveryCrawlEventRecord {
  id: string;
  orgId: string;
  connectorId: string;
  triggeredBy: string | null;
  startedAt: string;
  completedAt: string | null;
  status: DiscoveryCrawlStatus;
  catalogsWalked: number;
  schemasWalked: number;
  tablesFound: number;
  sourcesCreated: number;
  sourcesSkipped: number;
  snapshotsCaptured: number;
  snapshotsFailed: number;
  errorMessage: string | null;
}

@Injectable()
export class ConnectorsService {
  private readonly logger = new Logger(ConnectorsService.name);

  constructor(
    @InjectRepository(ConnectorEntity)
    private readonly connectorRepo: Repository<ConnectorEntity>,
    @InjectRepository(ConnectorHealthEventEntity)
    private readonly healthEventRepo: Repository<ConnectorHealthEventEntity>,
    @InjectRepository(SourceRegistrationEntity)
    private readonly sourceRepo: Repository<SourceRegistrationEntity>,
    @InjectRepository(SchemaSnapshotEntity)
    private readonly snapshotRepo: Repository<SchemaSnapshotEntity>,
    @InjectRepository(DiscoveryCrawlEventEntity)
    private readonly crawlEventRepo: Repository<DiscoveryCrawlEventEntity>,
    @InjectRepository(RoleAssignmentEntity)
    private readonly roleRepo: Repository<RoleAssignmentEntity>,
    private readonly probeService: ConnectorProbeService,
    private readonly capabilityManifestService: CapabilityManifestService,
    private readonly lineageService: LineageService,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly notificationsService: NotificationsService,
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

    // 6. Auto-crawl on registration (B-063 Layer 3b). Fire-and-forget if the
    //    capability manifest says discovery is supported AND the probe came
    //    back healthy. We don't block the create response on the crawl — it
    //    can take seconds, and crawl outcomes land on the crawl-events
    //    history where operators can inspect them.
    //
    //    No Temporal yet (Layer 3c). This is plain async with error capture,
    //    which is non-durable across api restarts. For demo and dev that's
    //    fine; production will want the durable workflow.
    if (updated && updated.validationStatus === 'valid') {
      const manifest = await this.capabilityManifestService.getLatestForType(
        updated.connectorType,
      );
      if (manifest?.supportsDiscoveryCrawl) {
        void this.crawlConnector(orgId, updated.id, createdBy).catch((err) => {
          this.logger.warn(
            `Auto-crawl on registration failed for connector ${updated.id}: ${(err as Error).message}`,
          );
        });
      }
    }

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
      where: { connectorId, orgId, sourceRef: dto.sourceRef },
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
  // Discovery crawl (B-063 Layer 3a)
  // ---------------------------------------------------------------------------

  /**
   * Walks the connector's external system, registers any new sources it
   * finds, and captures a schema snapshot for each. Idempotent —
   * pre-existing sources (matched by sourceRef) are skipped. Records the
   * outcome in `connectors.discovery_crawl_events` so the operator has a
   * history of what each crawl produced.
   *
   * Today only Databricks is supported (via Unity Catalog REST). Other
   * connector types will get a NotSupported error until their walkers ship.
   *
   * Scheduled re-crawls (Temporal-driven) are a separate follow-on PR;
   * this method only handles the operator-triggered case.
   */
  async crawlConnector(
    orgId: string,
    connectorId: string,
    triggeredBy: string,
  ): Promise<DiscoveryCrawlEventRecord> {
    const connector = await this.connectorRepo.findOne({
      where: { id: connectorId, orgId },
    });
    if (!connector) throw new NotFoundException(`Connector ${connectorId} not found`);
    if (connector.connectorType !== 'databricks') {
      throw new BadRequestException(
        `Discovery crawl is not yet implemented for connector type '${connector.connectorType}'. See B-063.`,
      );
    }

    let event = await this.crawlEventRepo.save(
      this.crawlEventRepo.create({
        orgId,
        connectorId,
        triggeredBy,
        status: 'running' as DiscoveryCrawlStatus,
      }),
    );

    try {
      const catalogScope = Array.isArray(connector.connectionConfig.catalogs)
        ? (connector.connectionConfig.catalogs as string[])
        : undefined;
      const walk = await this.probeService.walkDatabricksWorkspace(connector, catalogScope);

      let sourcesCreated = 0;
      let sourcesSkipped = 0;
      let snapshotsCaptured = 0;
      let snapshotsFailed = 0;

      for (const table of walk.tables) {
        const existing = await this.sourceRepo.findOne({
          where: { connectorId, orgId, sourceRef: table.fullName },
        });
        if (existing) {
          sourcesSkipped++;
          continue;
        }
        const source = await this.sourceRepo.save(
          this.sourceRepo.create({
            orgId,
            connectorId,
            sourceRef: table.fullName,
            sourceType: 'table',
            displayName: table.name,
            description: `Discovered from ${table.catalog}.${table.schema}`,
            registeredBy: triggeredBy,
          }),
        );
        sourcesCreated++;
        try {
          const inferred = await this.probeService.inferSchema(connector, source);
          await this.snapshotRepo.save(
            this.snapshotRepo.create({
              orgId,
              sourceRegistrationId: source.id,
              connectorId,
              schemaDefinition: inferred.schemaDefinition,
              columnCount: inferred.columnCount,
              rowEstimate: inferred.rowEstimate,
              capturedBy: triggeredBy,
            }),
          );
          snapshotsCaptured++;
        } catch (err) {
          this.logger.warn(
            `Discovery crawl snapshot failed for ${table.fullName}: ${(err as Error).message}`,
          );
          snapshotsFailed++;
        }
      }

      // Lineage projection (B-063 Layer 4). For each discovered table,
      // pull its upstream + downstream lineage from Unity Catalog and
      // emit the edges via LineageService — same path the SDK uses, so
      // edges land in PostgreSQL (emission_log) and Neo4j (the graph)
      // with the same idempotency + trust-score recompute semantics.
      // Idempotency key is deterministic so re-crawls don't duplicate
      // edges. emitted_by carries the system-discovered marker.
      let lineageEdgesEmitted = 0;
      let lineageEdgesSkipped = 0;
      let lineageEdgesFailed = 0;
      let tablesWithLineageErrors: string[] = [];
      if (walk.tables.length > 0) {
        try {
          const fullNames = walk.tables.map((t) => t.fullName);
          const lineageResult = await this.probeService.walkDatabricksLineage(
            connector,
            fullNames,
          );
          tablesWithLineageErrors = lineageResult.tablesWithErrors;
          for (const edge of lineageResult.edges) {
            try {
              const before = await this.lineageService.emitEvent(orgId, {
                source_node: {
                  node_type: 'Source',
                  node_id: edge.sourceFullName,
                  org_id: orgId,
                  display_name: edge.sourceFullName,
                  metadata: { connectorType: 'databricks' },
                },
                target_node: {
                  node_type: 'Source',
                  node_id: edge.targetFullName,
                  org_id: orgId,
                  display_name: edge.targetFullName,
                  metadata: { connectorType: 'databricks' },
                },
                edge_type: 'DERIVES_FROM',
                emitted_by: 'databricks-discovery-crawl',
                confidence: 1.0,
                idempotency_key: `databricks-lineage:${connectorId}:${edge.sourceFullName}->${edge.targetFullName}`,
              });
              // The emission service returns the existing entry on
              // idempotency hit (re-crawl). Distinguish "new" vs "skipped"
              // by checking whether the row pre-dates this crawl event.
              if (before.createdAt < event.startedAt) {
                lineageEdgesSkipped++;
              } else {
                lineageEdgesEmitted++;
              }
            } catch (err) {
              this.logger.warn(
                `Lineage emission failed for ${edge.sourceFullName} -> ${edge.targetFullName}: ${(err as Error).message}`,
              );
              lineageEdgesFailed++;
            }
          }
        } catch (err) {
          this.logger.warn(
            `Lineage walk failed (continuing without lineage projection): ${(err as Error).message}`,
          );
        }
      }

      event.completedAt = new Date();
      const hadFailures = snapshotsFailed > 0 || lineageEdgesFailed > 0 || tablesWithLineageErrors.length > 0;
      event.status = (hadFailures ? 'partial' : 'succeeded') as DiscoveryCrawlStatus;
      event.catalogsWalked = walk.catalogs.length;
      event.schemasWalked = walk.schemasWalked;
      event.tablesFound = walk.tables.length;
      event.sourcesCreated = sourcesCreated;
      event.sourcesSkipped = sourcesSkipped;
      event.snapshotsCaptured = snapshotsCaptured;
      event.snapshotsFailed = snapshotsFailed;
      event.metadata = {
        ...event.metadata,
        lineageEdgesEmitted,
        lineageEdgesSkipped,
        lineageEdgesFailed,
        tablesWithLineageErrors,
      };
      event = await this.crawlEventRepo.save(event);
      return this.toDiscoveryCrawlEvent(event);
    } catch (err) {
      event.completedAt = new Date();
      event.status = 'failed' as DiscoveryCrawlStatus;
      event.errorMessage = (err as Error).message ?? 'Unknown error';
      await this.crawlEventRepo.save(event);
      throw new BadRequestException(
        `Discovery crawl failed: ${(err as Error).message}`,
      );
    }
  }

  async listCrawlEvents(
    orgId: string,
    connectorId: string,
    limit: number,
  ): Promise<DiscoveryCrawlEventRecord[]> {
    const exists = await this.connectorRepo.findOne({
      where: { id: connectorId, orgId },
    });
    if (!exists) throw new NotFoundException(`Connector ${connectorId} not found`);
    const items = await this.crawlEventRepo.find({
      where: { connectorId, orgId },
      order: { startedAt: 'DESC' },
      take: limit,
    });
    return items.map((e) => this.toDiscoveryCrawlEvent(e));
  }

  private toDiscoveryCrawlEvent(e: DiscoveryCrawlEventEntity): DiscoveryCrawlEventRecord {
    return {
      id: e.id,
      orgId: e.orgId,
      connectorId: e.connectorId,
      triggeredBy: e.triggeredBy,
      startedAt: e.startedAt.toISOString(),
      completedAt: e.completedAt ? e.completedAt.toISOString() : null,
      status: e.status,
      catalogsWalked: e.catalogsWalked,
      schemasWalked: e.schemasWalked,
      tablesFound: e.tablesFound,
      sourcesCreated: e.sourcesCreated,
      sourcesSkipped: e.sourcesSkipped,
      snapshotsCaptured: e.snapshotsCaptured,
      snapshotsFailed: e.snapshotsFailed,
      errorMessage: e.errorMessage,
    };
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
    const previousStatus = connector.validationStatus;
    connector.validationStatus = newStatus;
    connector.lastValidatedAt = healthEvent.checkedAt;
    await this.connectorRepo.save(connector);

    // F11.18 — fire connector health degraded notification on transition
    // valid → invalid. Only on transition (not while continuously invalid)
    // so the domain owner gets one notification per incident, not one per
    // probe cycle. Best-effort: never fail the probe call because of
    // notification failure.
    if (previousStatus === 'valid' && newStatus === 'invalid') {
      try {
        const recipients = await this.domainOwners(connector.orgId, connector.domainId);
        if (recipients.length > 0) {
          await this.notificationsService.enqueue({
            orgId: connector.orgId,
            category: 'connector_health_degraded',
            recipients,
            payload: {
              connectorId: connector.id,
              connectorName: connector.name,
              domainId: connector.domainId,
              probeStatus: result.status,
              errorMessage: result.errorMessage ?? null,
              checkedAt: healthEvent.checkedAt.toISOString(),
            },
            deepLink: `/admin/connectors/${connector.id}`,
            // dedup_key per-connector — flapping in/out of invalid within
            // the dedup window collapses to one notification.
            dedupKey: `connector_health_degraded:${connector.id}`,
          });
        }
      } catch (err) {
        this.logger.error(
          `Connector health degraded notification enqueue failed for ${connector.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

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

  /**
   * Resolves principal IDs of domain owners for the given (org, domain) pair.
   * F11.18 recipient set per PRD: "the domain owner of the domain that
   * registered the connector."
   */
  private async domainOwners(orgId: string, domainId: string): Promise<string[]> {
    const rows = await this.roleRepo.find({
      where: { orgId, role: 'domain_owner', domainId },
    });
    return rows.map((r) => r.principalId);
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
