import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PrincipalEntity } from '../organizations/entities/principal.entity.js';
import { DomainEntity } from '../organizations/entities/domain.entity.js';
import { SloDeclarationEntity } from '../observability/entities/slo-declaration.entity.js';
import { SloEvaluationEntity } from '../observability/entities/slo-evaluation.entity.js';
import { AccessGrantEntity } from '../access/entities/access-grant.entity.js';
import { AccessRequestEntity } from '../access/entities/access-request.entity.js';
import { SchemaSnapshotEntity } from '../connectors/entities/schema-snapshot.entity.js';
import { PortDeclarationEntity } from './entities/port-declaration.entity.js';
import { DataProductEntity } from './entities/data-product.entity.js';
import { EncryptionService, type EncryptedEnvelope } from '../common/encryption.service.js';
import type {
  ProductOwner,
  ProductDomainTeam,
  ProductFreshness,
  ProductAccessStatus,
  ProductColumnSchema,
  ConnectionDetails,
  ConnectionDetailsPreview,
  OutputPortInterfaceType,
  RequestContext,
} from '@provenance/types';

export interface ProductEnrichmentFields {
  owner:        ProductOwner | null;
  domainTeam:   ProductDomainTeam | null;
  freshness:    ProductFreshness | null;
  accessStatus: ProductAccessStatus | null;
  columnSchema: ProductColumnSchema | null;
}

interface EnrichableProduct {
  id: string;
  orgId: string;
  domainId: string;
  ownerPrincipalId: string;
}

@Injectable()
export class ProductEnrichmentService {
  private readonly logger = new Logger(ProductEnrichmentService.name);

  constructor(
    @InjectRepository(PrincipalEntity)       private readonly principalRepo:     Repository<PrincipalEntity>,
    @InjectRepository(DomainEntity)          private readonly domainRepo:        Repository<DomainEntity>,
    @InjectRepository(SloDeclarationEntity)  private readonly sloDeclRepo:       Repository<SloDeclarationEntity>,
    @InjectRepository(SloEvaluationEntity)   private readonly sloEvalRepo:       Repository<SloEvaluationEntity>,
    @InjectRepository(AccessGrantEntity)     private readonly accessGrantRepo:   Repository<AccessGrantEntity>,
    @InjectRepository(AccessRequestEntity)   private readonly accessRequestRepo: Repository<AccessRequestEntity>,
    @InjectRepository(SchemaSnapshotEntity)  private readonly schemaSnapshotRepo: Repository<SchemaSnapshotEntity>,
    private readonly encryptionService: EncryptionService,
  ) {}

  async enrich(product: EnrichableProduct, ctx?: RequestContext): Promise<ProductEnrichmentFields> {
    const [owner, domainTeam, freshness, accessStatus, columnSchema] = await Promise.all([
      this.resolveOwner(product.ownerPrincipalId),
      this.resolveDomainTeam(product.domainId),
      this.resolveFreshness(product.orgId, product.id),
      ctx ? this.resolveAccessStatus(product.orgId, product.id, ctx) : Promise.resolve(null),
      this.resolveColumnSchema(),
    ]);
    return { owner, domainTeam, freshness, accessStatus, columnSchema };
  }

  async resolveOwner(ownerPrincipalId: string): Promise<ProductOwner | null> {
    try {
      const principal = await this.principalRepo.findOne({ where: { id: ownerPrincipalId } });
      if (!principal) return null;
      return { id: principal.id, displayName: principal.displayName, email: principal.email };
    } catch { return null; }
  }

  async resolveDomainTeam(domainId: string): Promise<ProductDomainTeam | null> {
    try {
      const domain = await this.domainRepo.findOne({ where: { id: domainId } });
      if (!domain) return null;
      const domainOwner = await this.principalRepo.findOne({ where: { id: domain.ownerPrincipalId } });
      return {
        id: domain.id,
        name: domain.name,
        ownerDisplayName: domainOwner?.displayName ?? null,
        ownerEmail: domainOwner?.email ?? null,
      };
    } catch { return null; }
  }

  async resolveFreshness(orgId: string, productId: string): Promise<ProductFreshness | null> {
    try {
      const decl = await this.sloDeclRepo.findOne({
        where: { orgId, productId, sloType: 'freshness', active: true },
        order: { createdAt: 'DESC' },
      });
      if (!decl) return null;
      const evaluation = await this.sloEvalRepo.findOne({
        where: { sloId: decl.id, orgId },
        order: { evaluatedAt: 'DESC' },
      });
      if (!evaluation) return null;
      return {
        lastRefreshedAt: null,
        sloType: decl.sloType,
        passed: evaluation.passed,
        measuredValue: evaluation.measuredValue ?? null,
        evaluatedAt: evaluation.evaluatedAt.toISOString(),
      };
    } catch { return null; }
  }

  async resolveAccessStatus(orgId: string, productId: string, ctx: RequestContext): Promise<ProductAccessStatus | null> {
    try {
      const principalId = ctx.principalId;
      const grant = await this.accessGrantRepo.findOne({
        where: { orgId, productId, granteePrincipalId: principalId },
        order: { grantedAt: 'DESC' },
      });
      if (grant && !grant.revokedAt && (!grant.expiresAt || grant.expiresAt > new Date())) {
        return {
          status: 'granted',
          grantedAt: grant.grantedAt.toISOString(),
          expiresAt: grant.expiresAt?.toISOString() ?? null,
        };
      }
      const request = await this.accessRequestRepo.findOne({
        where: { orgId, productId, requesterPrincipalId: principalId, status: 'pending' },
      });
      if (request) return { status: 'pending', grantedAt: null, expiresAt: null };
      const denied = await this.accessRequestRepo.findOne({
        where: { orgId, productId, requesterPrincipalId: principalId, status: 'denied' },
        order: { resolvedAt: 'DESC' },
      });
      if (denied) return { status: 'denied', grantedAt: null, expiresAt: null };
      return { status: 'not_requested', grantedAt: null, expiresAt: null };
    } catch { return null; }
  }

  // No direct product-to-schema_snapshot FK exists yet.
  // When a linking mechanism is added, this will query schemaSnapshotRepo.
  resolveColumnSchema(): Promise<ProductColumnSchema | null> {
    void this.schemaSnapshotRepo;
    return Promise.resolve(null);
  }

  // ---------------------------------------------------------------------------
  // Connection details disclosure (F10.6)
  //
  // Full connectionDetails are returned only when the requesting principal has
  // an active (non-revoked, non-expired) access grant. Authenticated principals
  // without a grant see a host/endpoint-only redacted preview. Unauthenticated
  // callers see neither — both fields return null. The product owner is
  // treated as having a grant for their own product.
  // ---------------------------------------------------------------------------

  async hasActiveGrant(
    orgId: string,
    productId: string,
    principalId: string,
  ): Promise<boolean> {
    try {
      const grant = await this.accessGrantRepo.findOne({
        where: { orgId, productId, granteePrincipalId: principalId },
        order: { grantedAt: 'DESC' },
      });
      if (!grant) return false;
      if (grant.revokedAt) return false;
      if (grant.expiresAt && grant.expiresAt <= new Date()) return false;
      return true;
    } catch {
      return false;
    }
  }

  async disclosePortConnectionDetails(
    port: PortDeclarationEntity,
    product: Pick<DataProductEntity, 'id' | 'orgId' | 'ownerPrincipalId'>,
    ctx: RequestContext | undefined,
  ): Promise<{
    connectionDetails: ConnectionDetails | null;
    connectionDetailsPreview: ConnectionDetailsPreview | null;
  }> {
    // Unauthenticated — nothing is disclosed.
    if (!ctx || !ctx.principalId) {
      return { connectionDetails: null, connectionDetailsPreview: null };
    }
    if (!port.interfaceType || port.connectionDetails === null) {
      return { connectionDetails: null, connectionDetailsPreview: null };
    }

    const isOwner = product.ownerPrincipalId === ctx.principalId;
    const hasGrant = isOwner
      ? true
      : await this.hasActiveGrant(product.orgId, product.id, ctx.principalId);

    if (hasGrant) {
      const full = await this.decryptStoredDetails(port);
      if (!full) {
        // Decrypt failed — fall back to preview rather than throwing.
        return {
          connectionDetails: null,
          connectionDetailsPreview: this.buildPreview(port.interfaceType, null),
        };
      }
      return {
        connectionDetails: full,
        connectionDetailsPreview: null,
      };
    }

    // Authenticated but not authorized — return redacted preview.
    const plaintext = await this.decryptStoredDetails(port);
    return {
      connectionDetails: null,
      connectionDetailsPreview: this.buildPreview(port.interfaceType, plaintext),
    };
  }

  private async decryptStoredDetails(
    port: PortDeclarationEntity,
  ): Promise<ConnectionDetails | null> {
    if (port.connectionDetails === null) return null;
    try {
      if (port.connectionDetailsEncrypted) {
        if (!EncryptionService.isEnvelope(port.connectionDetails)) return null;
        return await this.encryptionService.decrypt<ConnectionDetails>(
          port.connectionDetails as unknown as EncryptedEnvelope,
        );
      }
      return port.connectionDetails as unknown as ConnectionDetails;
    } catch (err) {
      this.logger.error(
        `Failed to decrypt connection details for port ${port.id}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private buildPreview(
    interfaceType: OutputPortInterfaceType,
    details: ConnectionDetails | null,
  ): ConnectionDetailsPreview {
    const base: ConnectionDetailsPreview = { kind: interfaceType, redacted: true };
    if (!details) return base;
    switch (details.kind) {
      case 'sql_jdbc':
        return { ...base, host: details.host };
      case 'rest_api':
        return { ...base, endpoint: details.baseUrl };
      case 'graphql':
        return { ...base, endpoint: details.endpointUrl };
      case 'streaming_topic':
        return { ...base, host: details.bootstrapServers, topic: details.topic };
      case 'file_object_export':
        return { ...base, bucket: details.bucket };
      default:
        return base;
    }
  }
}
