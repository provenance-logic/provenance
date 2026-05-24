import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
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
  ProductColumnSchemaColumn,
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
    @InjectRepository(PortDeclarationEntity) private readonly portRepo:          Repository<PortDeclarationEntity>,
    private readonly encryptionService: EncryptionService,
  ) {}

  async enrich(product: EnrichableProduct, ctx?: RequestContext): Promise<ProductEnrichmentFields> {
    // resolveBoundSnapshot is the shared lookup behind both the
    // columnSchema and freshness enrichments — both read the latest
    // schema snapshot of the first source-bound output port (F2.8a).
    // Done once here and threaded through to avoid two queries.
    const boundSnapshot = await this.resolveBoundSnapshot(product.orgId, product.id);
    const [owner, domainTeam, freshness, accessStatus, columnSchema] = await Promise.all([
      this.resolveOwner(product.orgId, product.ownerPrincipalId),
      this.resolveDomainTeam(product.orgId, product.domainId),
      this.resolveFreshness(product.orgId, product.id, boundSnapshot),
      ctx ? this.resolveAccessStatus(product.orgId, product.id, ctx) : Promise.resolve(null),
      this.resolveColumnSchema(boundSnapshot),
    ]);
    return { owner, domainTeam, freshness, accessStatus, columnSchema };
  }

  async resolveOwner(orgId: string, ownerPrincipalId: string): Promise<ProductOwner | null> {
    try {
      const principal = await this.principalRepo.findOne({ where: { id: ownerPrincipalId, orgId } });
      if (!principal) return null;
      return { id: principal.id, displayName: principal.displayName, email: principal.email };
    } catch { return null; }
  }

  async resolveDomainTeam(orgId: string, domainId: string): Promise<ProductDomainTeam | null> {
    try {
      const domain = await this.domainRepo.findOne({ where: { id: domainId, orgId } });
      if (!domain) return null;
      const domainOwner = await this.principalRepo.findOne({ where: { id: domain.ownerPrincipalId, orgId } });
      return {
        id: domain.id,
        name: domain.name,
        ownerDisplayName: domainOwner?.displayName ?? null,
        ownerEmail: domainOwner?.email ?? null,
      };
    } catch { return null; }
  }

  async resolveFreshness(
    orgId: string,
    productId: string,
    boundSnapshot?: SchemaSnapshotEntity | null,
  ): Promise<ProductFreshness | null> {
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
      // F2.8a — when an output port is bound to a discovered source,
      // the latest schema_snapshot's captured_at is "when the platform
      // last saw the source's schema" — the closest defensible proxy
      // for source-side freshness in the absence of pipeline emission
      // data. Pre-B-070 this was always null with a "pending FK" note.
      const snapshot = boundSnapshot === undefined
        ? await this.resolveBoundSnapshot(orgId, productId)
        : boundSnapshot;
      return {
        lastRefreshedAt: snapshot?.capturedAt.toISOString() ?? null,
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
          grantId: grant.id,
        };
      }
      const request = await this.accessRequestRepo.findOne({
        where: { orgId, productId, requesterPrincipalId: principalId, status: 'pending' },
      });
      if (request) return { status: 'pending', grantedAt: null, expiresAt: null, grantId: null };
      const denied = await this.accessRequestRepo.findOne({
        where: { orgId, productId, requesterPrincipalId: principalId, status: 'denied' },
        order: { resolvedAt: 'DESC' },
      });
      if (denied) return { status: 'denied', grantedAt: null, expiresAt: null, grantId: null };
      return { status: 'not_requested', grantedAt: null, expiresAt: null, grantId: null };
    } catch { return null; }
  }

  /**
   * F2.8a (closes B-070). Returns the latest schema snapshot for the
   * product's first source-bound output port, shaped as a
   * `ProductColumnSchema`. A product can have multiple output ports
   * each bound to a different source object; today's contract returns
   * one schema per product, so the first bound port wins. Per-port
   * schemas are a follow-up if/when needed.
   *
   * Returns null when the product has no bound port, the bound source
   * has no captured snapshot, or the snapshot's schema_definition
   * doesn't carry a `columns` array (e.g. S3-prefix snapshots).
   */
  resolveColumnSchema(
    boundSnapshot?: SchemaSnapshotEntity | null,
  ): Promise<ProductColumnSchema | null> {
    if (boundSnapshot === undefined || boundSnapshot === null) {
      return Promise.resolve(null);
    }
    const def = boundSnapshot.schemaDefinition as { columns?: unknown };
    if (!Array.isArray(def.columns)) return Promise.resolve(null);
    const columns: ProductColumnSchemaColumn[] = (def.columns as Array<Record<string, unknown>>)
      .filter((c) => typeof c.name === 'string' && typeof c.type === 'string')
      .map((c) => ({
        name: c.name as string,
        type: c.type as string,
        nullable: c.nullable !== false,
      }));
    if (columns.length === 0) return Promise.resolve(null);
    return Promise.resolve({
      columns,
      columnCount: boundSnapshot.columnCount ?? columns.length,
      rowEstimate: boundSnapshot.rowEstimate ?? null,
      capturedAt: boundSnapshot.capturedAt.toISOString(),
    });
  }

  /**
   * F2.8a — Resolves the latest schema snapshot for the first output
   * port of `productId` that has a non-NULL source binding. Returns
   * null when no ports are bound or the bound source has no captured
   * snapshot yet. Used by both `resolveColumnSchema` (for the columns)
   * and `resolveFreshness` (for the capturedAt timestamp).
   */
  private async resolveBoundSnapshot(
    orgId: string,
    productId: string,
  ): Promise<SchemaSnapshotEntity | null> {
    try {
      const boundPort = await this.portRepo.findOne({
        where: {
          orgId,
          productId,
          portType: 'output',
          sourceRegistrationId: Not(IsNull()),
        },
        order: { createdAt: 'ASC' },
      });
      if (!boundPort || !boundPort.sourceRegistrationId) return null;
      return await this.schemaSnapshotRepo.findOne({
        where: { orgId, sourceRegistrationId: boundPort.sourceRegistrationId },
        order: { capturedAt: 'DESC' },
      });
    } catch {
      return null;
    }
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
