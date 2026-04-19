import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
  BadRequestException,
  NotImplementedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { DataProductEntity } from './entities/data-product.entity.js';
import { PortDeclarationEntity } from './entities/port-declaration.entity.js';
import { ProductVersionEntity } from './entities/product-version.entity.js';
import { LifecycleEventEntity } from './entities/lifecycle-event.entity.js';
import { PrincipalEntity } from '../organizations/entities/principal.entity.js';
import { GovernanceService } from '../governance/governance.service.js';
import { KafkaProducerService } from '../kafka/kafka-producer.service.js';
import { SearchIndexingService } from '../search/search-indexing.service.js';
import { ProductEnrichmentService } from './product-enrichment.service.js';
import { EncryptionService } from '../common/encryption.service.js';
import { validateConnectionDetails } from './connection-details.schemas.js';
import type {
  DataProduct,
  DataProductList,
  CreateDataProductRequest,
  UpdateDataProductRequest,
  DataProductStatus,
  Port,
  PortList,
  DeclarePortRequest,
  UpdatePortRequest,
  ProductVersion,
  ProductVersionList,
  PublishProductRequest,
  ProductPublishedEvent,
  RequestContext,
  ConnectionDetails,
  OutputPortInterfaceType,
} from '@provenance/types';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(DataProductEntity)
    private readonly productRepo: Repository<DataProductEntity>,
    @InjectRepository(PortDeclarationEntity)
    private readonly portRepo: Repository<PortDeclarationEntity>,
    @InjectRepository(ProductVersionEntity)
    private readonly versionRepo: Repository<ProductVersionEntity>,
    @InjectRepository(LifecycleEventEntity)
    private readonly lifecycleEventRepo: Repository<LifecycleEventEntity>,
    @InjectRepository(PrincipalEntity)
    private readonly principalRepo: Repository<PrincipalEntity>,
    private readonly governanceService: GovernanceService,
    private readonly kafkaProducerService: KafkaProducerService,
    private readonly searchIndexingService: SearchIndexingService,
    private readonly enrichmentService: ProductEnrichmentService,
    private readonly encryptionService: EncryptionService,
  ) {}

  // ---------------------------------------------------------------------------
  // Data Products
  // ---------------------------------------------------------------------------

  async listProducts(
    orgId: string,
    domainId: string,
    limit: number,
    offset: number,
    status?: DataProductStatus,
  ): Promise<DataProductList> {
    const where = status
      ? { orgId, domainId, status }
      : { orgId, domainId };
    const [items, total] = await this.productRepo.findAndCount({
      where,
      relations: ['ports'],
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return {
      items: items.map((i) => this.toDataProduct(i)),
      meta: { total, limit, offset },
    };
  }

  async createProduct(
    orgId: string,
    domainId: string,
    dto: CreateDataProductRequest,
    ctx: RequestContext,
  ): Promise<DataProduct> {
    const existing = await this.productRepo.findOne({ where: { orgId, domainId, slug: dto.slug } });
    if (existing) {
      throw new ConflictException(`Data product with slug '${dto.slug}' already exists in this domain`);
    }
    const principal = await this.ensurePrincipal(orgId, ctx);
    const product = this.productRepo.create({
      orgId,
      domainId,
      name: dto.name,
      slug: dto.slug,
      description: dto.description ?? null,
      classification: dto.classification,
      ownerPrincipalId: principal.id,
      tags: dto.tags ?? [],
      status: 'draft',
      version: '0.1.0',
    });
    const saved = await this.productRepo.save(product);

    // Record initial version snapshot.
    await this.versionRepo.save(
      this.versionRepo.create({
        orgId,
        productId: saved.id,
        version: saved.version,
        changeDescription: 'Initial draft',
        snapshot: this.toDataProduct({ ...saved, ports: [] }),
        createdByPrincipalId: principal.id,
      }),
    );

    return this.toDataProduct({ ...saved, ports: [] });
  }

  async getProduct(orgId: string, domainId: string, productId: string, ctx?: RequestContext): Promise<DataProduct> {
    const product = await this.productRepo.findOne({
      where: { id: productId, orgId, domainId },
      relations: ['ports'],
    });
    if (!product) throw new NotFoundException(`Data product ${productId} not found`);

    const enrichment = await this.enrichmentService.enrich(
      { id: product.id, orgId: product.orgId, domainId: product.domainId, ownerPrincipalId: product.ownerPrincipalId },
      ctx,
    );

    // Per-port connection-details disclosure (F10.6) — full for granted
    // principals (owner counts), redacted preview for authed-no-grant, nothing
    // for unauthenticated. Runs sequentially because decrypt() is cheap and
    // ports are small per product; parallelize if this becomes a hot path.
    const baseDto = this.toDataProduct(product);
    const discloseBase = { id: product.id, orgId: product.orgId, ownerPrincipalId: product.ownerPrincipalId };
    const enrichedPorts: Port[] = [];
    for (let i = 0; i < baseDto.ports.length; i++) {
      const portEntity = product.ports[i];
      const { connectionDetails, connectionDetailsPreview } =
        await this.enrichmentService.disclosePortConnectionDetails(portEntity, discloseBase, ctx);
      enrichedPorts.push({ ...baseDto.ports[i], connectionDetails, connectionDetailsPreview });
    }

    return { ...baseDto, ports: enrichedPorts, ...enrichment };
  }

  async updateProduct(
    orgId: string,
    domainId: string,
    productId: string,
    dto: UpdateDataProductRequest,
  ): Promise<DataProduct> {
    const product = await this.productRepo.findOne({
      where: { id: productId, orgId, domainId },
      relations: ['ports'],
    });
    if (!product) throw new NotFoundException(`Data product ${productId} not found`);

    // Draft products: any field can be updated.
    // Published products: only name, description, and tags can be updated (metadata corrections).
    if (product.status !== 'draft' && product.status !== 'published') {
      throw new ConflictException(
        `Products in '${product.status}' state cannot be updated`,
      );
    }
    if (product.status === 'published') {
      if (dto.classification !== undefined || dto.ownerPrincipalId !== undefined) {
        throw new ConflictException(
          'Published products can only update name, description, and tags',
        );
      }
    }

    // Track whether searchable fields changed (for re-indexing published products)
    const nameChanged = dto.name !== undefined && dto.name !== product.name;
    const descChanged = dto.description !== undefined && dto.description !== product.description;
    const tagsChanged = dto.tags !== undefined &&
      JSON.stringify(dto.tags) !== JSON.stringify(product.tags);
    const searchFieldsChanged = nameChanged || descChanged || tagsChanged;

    if (dto.name !== undefined) product.name = dto.name;
    if (dto.description !== undefined) product.description = dto.description;
    if (dto.classification !== undefined) product.classification = dto.classification;
    if (dto.ownerPrincipalId !== undefined) product.ownerPrincipalId = dto.ownerPrincipalId;
    if (dto.tags !== undefined) product.tags = dto.tags;
    const saved = await this.productRepo.save(product);

    // Fire-and-forget: re-index if published product's searchable fields changed
    if (product.status === 'published' && searchFieldsChanged) {
      this.searchIndexingService.indexProduct(product.id, orgId).catch(() => {});
    }

    return this.toDataProduct(saved);
  }

  async deleteProduct(orgId: string, domainId: string, productId: string): Promise<void> {
    const product = await this.productRepo.findOne({ where: { id: productId, orgId, domainId } });
    if (!product) throw new NotFoundException(`Data product ${productId} not found`);
    if (product.status !== 'draft') {
      throw new ConflictException('Only draft products can be deleted');
    }
    await this.productRepo.remove(product);
  }

  // ---------------------------------------------------------------------------
  // Publish
  // ---------------------------------------------------------------------------

  async publishProduct(
    orgId: string,
    domainId: string,
    productId: string,
    dto: PublishProductRequest,
    ctx: RequestContext,
  ): Promise<DataProduct> {
    // 1. Ensure principal record exists and resolve Provenance principal ID
    const principal = await this.ensurePrincipal(orgId, ctx);
    const triggeredBy = principal.id;

    // 2. Load product with ports
    const product = await this.productRepo.findOne({
      where: { id: productId, orgId, domainId },
      relations: ['ports'],
    });
    if (!product) throw new NotFoundException(`Data product ${productId} not found`);

    // 3. Must be in draft status
    if (product.status !== 'draft') {
      throw new ConflictException(
        `Product must be in draft status to publish; current status is '${product.status}'`,
      );
    }

    // 3. Port presence validation
    const ports = product.ports ?? [];
    const outputPorts = ports.filter((p) => p.portType === 'output');
    const discoveryPorts = ports.filter((p) => p.portType === 'discovery');

    if (outputPorts.length === 0) {
      throw new UnprocessableEntityException(
        'Publication requires at least one output port',
      );
    }
    if (discoveryPorts.length === 0) {
      throw new UnprocessableEntityException(
        'Publication requires at least one discovery port',
      );
    }

    // 4. Port contract validation — every output port must have a contract schema
    const missingContracts = outputPorts.filter((p) => !p.contractSchema);
    if (missingContracts.length > 0) {
      const names = missingContracts.map((p) => p.name).join(', ');
      throw new UnprocessableEntityException(
        `Output ports must have a contract schema: ${names}`,
      );
    }

    // 4b. Connection details required on every output port (F10.5).
    // Semantic query endpoints are platform-populated and exempted from the
    // authoring-time requirement — the federated query layer fills them in.
    const missingConnectionDetails = outputPorts.filter(
      (p) =>
        p.interfaceType !== 'semantic_query_endpoint' &&
        (p.connectionDetails === null || p.connectionDetails === undefined),
    );
    if (missingConnectionDetails.length > 0) {
      const names = missingConnectionDetails.map((p) => p.name).join(', ');
      throw new UnprocessableEntityException(
        `Output ports must have connection details: ${names}`,
      );
    }

    // 5. Governance evaluation
    const productDto = this.toDataProduct(product);
    const evaluation = await this.governanceService.evaluate(orgId, productDto);
    if (evaluation.violations.length > 0) {
      throw new UnprocessableEntityException({
        message: 'Governance policy violations prevent publication',
        violations: evaluation.violations,
      });
    }

    // 6. Bump major version (0.1.0 → 1.0.0, 1.0.0 → 2.0.0, etc.)
    const newVersion = this.bumpMajor(product.version);

    // 7. Update product status and version
    product.status = 'published';
    product.version = newVersion;
    const savedProduct = await this.productRepo.save(product);
    savedProduct.ports = product.ports; // restore loaded relation

    // 8. Write lifecycle event (append-only)
    await this.lifecycleEventRepo.save(
      this.lifecycleEventRepo.create({
        orgId,
        productId: product.id,
        fromStatus: 'draft',
        toStatus: 'published',
        triggeredBy,
        note: dto.changeDescription ?? null,
      }),
    );

    // 9. Create immutable version snapshot
    const snapshot = this.toDataProduct(savedProduct);
    await this.versionRepo.save(
      this.versionRepo.create({
        orgId,
        productId: product.id,
        version: newVersion,
        changeDescription: dto.changeDescription ?? null,
        snapshot,
        createdByPrincipalId: triggeredBy,
      }),
    );

    // 10. Publish event to product.lifecycle Redpanda topic
    const event: ProductPublishedEvent = {
      eventId: randomUUID(),
      schemaVersion: '1.0',
      eventType: 'product.published',
      orgId,
      productId: product.id,
      productSlug: product.slug,
      domainId: product.domainId,
      actorPrincipalId: triggeredBy,
      occurredAt: new Date().toISOString(),
      version: newVersion,
      changeDescription: dto.changeDescription ?? null,
      snapshot,
    };
    await this.kafkaProducerService.publish('product.lifecycle', product.id, event);

    // Fire-and-forget: index product embedding for semantic search.
    // Do not await — embedding failure must never block publish.
    this.searchIndexingService.indexProduct(product.id, orgId).catch(() => {});

    return snapshot;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle transitions (deprecate / decommission)
  // ---------------------------------------------------------------------------

  async deprecateProduct(
    orgId: string,
    domainId: string,
    productId: string,
  ): Promise<DataProduct> {
    const product = await this.productRepo.findOne({
      where: { id: productId, orgId, domainId },
      relations: ['ports'],
    });
    if (!product) throw new NotFoundException(`Data product ${productId} not found`);
    if (product.status !== 'published') {
      throw new ConflictException(`Product must be in published status to deprecate; current status is '${product.status}'`);
    }

    product.status = 'deprecated';
    const saved = await this.productRepo.save(product);
    saved.ports = product.ports;

    // Remove from semantic search index
    this.searchIndexingService.deleteFromIndex(productId).catch(() => {});

    return this.toDataProduct(saved);
  }

  async decommissionProduct(
    orgId: string,
    domainId: string,
    productId: string,
  ): Promise<DataProduct> {
    const product = await this.productRepo.findOne({
      where: { id: productId, orgId, domainId },
      relations: ['ports'],
    });
    if (!product) throw new NotFoundException(`Data product ${productId} not found`);
    if (product.status !== 'deprecated') {
      throw new ConflictException(`Product must be in deprecated status to decommission; current status is '${product.status}'`);
    }

    product.status = 'decommissioned';
    const saved = await this.productRepo.save(product);
    saved.ports = product.ports;

    // Remove from semantic search index
    this.searchIndexingService.deleteFromIndex(productId).catch(() => {});

    return this.toDataProduct(saved);
  }

  // ---------------------------------------------------------------------------
  // Ports
  // ---------------------------------------------------------------------------

  async listPorts(
    orgId: string,
    productId: string,
    limit: number,
    offset: number,
  ): Promise<PortList> {
    const [items, total] = await this.portRepo.findAndCount({
      where: { orgId, productId },
      order: { createdAt: 'ASC' },
      take: limit,
      skip: offset,
    });
    return {
      items: items.map((i) => this.toPort(i)),
      meta: { total, limit, offset },
    };
  }

  async declarePort(
    orgId: string,
    productId: string,
    dto: DeclarePortRequest,
  ): Promise<Port> {
    const { connectionDetails, connectionDetailsEncrypted } =
      await this.prepareConnectionDetails(dto.interfaceType, dto.connectionDetails);

    const port = this.portRepo.create({
      orgId,
      productId,
      portType: dto.portType,
      name: dto.name,
      description: dto.description ?? null,
      interfaceType: dto.interfaceType ?? null,
      contractSchema: dto.contractSchema ?? null,
      slaDescription: dto.slaDescription ?? null,
      connectionDetails,
      connectionDetailsEncrypted,
      connectionDetailsValidated: false,
    });
    const saved = await this.portRepo.save(port);
    return this.toPort(saved);
  }

  async getPort(orgId: string, productId: string, portId: string): Promise<Port> {
    const port = await this.portRepo.findOne({ where: { id: portId, orgId, productId } });
    if (!port) throw new NotFoundException(`Port ${portId} not found`);
    return this.toPort(port);
  }

  async updatePort(
    orgId: string,
    productId: string,
    portId: string,
    dto: UpdatePortRequest,
  ): Promise<Port> {
    const port = await this.portRepo.findOne({ where: { id: portId, orgId, productId } });
    if (!port) throw new NotFoundException(`Port ${portId} not found`);
    if (dto.name !== undefined) port.name = dto.name;
    if (dto.description !== undefined) port.description = dto.description;
    if (dto.interfaceType !== undefined) port.interfaceType = dto.interfaceType;
    if (dto.contractSchema !== undefined) port.contractSchema = dto.contractSchema;
    if (dto.slaDescription !== undefined) port.slaDescription = dto.slaDescription;
    if (dto.connectionDetails !== undefined) {
      const effectiveInterfaceType = dto.interfaceType ?? port.interfaceType;
      const { connectionDetails, connectionDetailsEncrypted } =
        await this.prepareConnectionDetails(effectiveInterfaceType, dto.connectionDetails);
      port.connectionDetails = connectionDetails;
      port.connectionDetailsEncrypted = connectionDetailsEncrypted;
      // Changing connection details invalidates any prior connectivity check.
      port.connectionDetailsValidated = false;
    }
    const saved = await this.portRepo.save(port);
    return this.toPort(saved);
  }

  async testConnection(orgId: string, productId: string, portId: string): Promise<never> {
    const port = await this.portRepo.findOne({ where: { id: portId, orgId, productId } });
    if (!port) throw new NotFoundException(`Port ${portId} not found`);
    // F10.7 — automated connectivity check is not yet implemented. The endpoint
    // is intentionally reachable so the UI can surface the expected message.
    throw new NotImplementedException(
      'Automated connection validation is not yet implemented. Mark the port as tested manually via the UI.',
    );
  }

  async deletePort(orgId: string, productId: string, portId: string): Promise<void> {
    const port = await this.portRepo.findOne({ where: { id: portId, orgId, productId } });
    if (!port) throw new NotFoundException(`Port ${portId} not found`);
    await this.portRepo.remove(port);
  }

  // ---------------------------------------------------------------------------
  // Versions
  // ---------------------------------------------------------------------------

  async listVersions(
    orgId: string,
    productId: string,
    limit: number,
    offset: number,
  ): Promise<ProductVersionList> {
    const [items, total] = await this.versionRepo.findAndCount({
      where: { orgId, productId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return {
      items: items.map((i) => this.toProductVersion(i)),
      meta: { total, limit, offset },
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async ensurePrincipal(orgId: string, ctx: RequestContext): Promise<PrincipalEntity> {
    const existing = await this.principalRepo.findOne({
      where: { keycloakSubject: ctx.keycloakSubject },
    });
    if (existing) return existing;
    await this.principalRepo
      .createQueryBuilder()
      .insert()
      .into(PrincipalEntity)
      .values({
        orgId,
        principalType: ctx.principalType,
        keycloakSubject: ctx.keycloakSubject,
        email: ctx.email ?? null,
        displayName: ctx.displayName ?? null,
      })
      .orIgnore()
      .execute();
    return this.principalRepo.findOneOrFail({
      where: { keycloakSubject: ctx.keycloakSubject },
    });
  }

  private bumpMajor(version: string): string {
    const [major] = version.split('.').map(Number);
    return `${major + 1}.0.0`;
  }

  // ---------------------------------------------------------------------------
  // Mappers
  // ---------------------------------------------------------------------------

  private toDataProduct(entity: DataProductEntity): DataProduct {
    return {
      id: entity.id,
      orgId: entity.orgId,
      domainId: entity.domainId,
      name: entity.name,
      slug: entity.slug,
      description: entity.description,
      status: entity.status,
      version: entity.version,
      classification: entity.classification,
      ownerPrincipalId: entity.ownerPrincipalId,
      tags: entity.tags,
      ports: (entity.ports ?? []).map((p) => this.toPort(p)),
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  private toPort(entity: PortDeclarationEntity): Port {
    return {
      id: entity.id,
      productId: entity.productId,
      orgId: entity.orgId,
      portType: entity.portType,
      name: entity.name,
      description: entity.description,
      interfaceType: entity.interfaceType,
      contractSchema: entity.contractSchema,
      slaDescription: entity.slaDescription,
      // Default mapper never surfaces decrypted details or previews — that
      // gating logic lives in ProductEnrichmentService (F10.6). Callers that
      // need disclosure must enrich explicitly.
      connectionDetails: null,
      connectionDetailsPreview: null,
      connectionDetailsValidated: entity.connectionDetailsValidated ?? false,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Connection details helpers (F10.5 / F10.6)
  // ---------------------------------------------------------------------------

  private async prepareConnectionDetails(
    interfaceType: OutputPortInterfaceType | null | undefined,
    details: ConnectionDetails | undefined,
  ): Promise<{
    connectionDetails: Record<string, unknown> | null;
    connectionDetailsEncrypted: boolean;
  }> {
    if (details === undefined) {
      return { connectionDetails: null, connectionDetailsEncrypted: false };
    }
    if (!interfaceType) {
      throw new BadRequestException(
        'connectionDetails requires an interfaceType on the port',
      );
    }
    // Zod validation throws on interface-mismatch or missing required fields.
    let validated: ConnectionDetails;
    try {
      validated = validateConnectionDetails(interfaceType, details);
    } catch (err) {
      throw new BadRequestException(
        `connectionDetails did not validate for interfaceType '${interfaceType}': ${
          (err as Error).message
        }`,
      );
    }
    const envelope = await this.encryptionService.encrypt(
      validated as unknown as Record<string, unknown>,
    );
    return {
      connectionDetails: envelope as unknown as Record<string, unknown>,
      connectionDetailsEncrypted: true,
    };
  }

  private toProductVersion(entity: ProductVersionEntity): ProductVersion {
    return {
      id: entity.id,
      productId: entity.productId,
      orgId: entity.orgId,
      version: entity.version,
      changeDescription: entity.changeDescription,
      snapshot: entity.snapshot,
      createdAt: entity.createdAt.toISOString(),
      createdByPrincipalId: entity.createdByPrincipalId ?? '',
    };
  }
}
