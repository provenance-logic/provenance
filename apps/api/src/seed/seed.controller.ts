import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { Public } from '../auth/public.decorator.js';
import { SeedGuard } from './seed.guard.js';
import { OrgEntity } from '../organizations/entities/org.entity.js';
import { DomainEntity } from '../organizations/entities/domain.entity.js';
import { PrincipalEntity } from '../organizations/entities/principal.entity.js';
import { RoleAssignmentEntity } from '../organizations/entities/role-assignment.entity.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { PortDeclarationEntity } from '../products/entities/port-declaration.entity.js';
import { AgentIdentityEntity } from '../agents/entities/agent-identity.entity.js';
import { AgentTrustClassificationEntity } from '../agents/entities/agent-trust-classification.entity.js';
import { PolicyVersionEntity } from '../governance/entities/policy-version.entity.js';
import { EffectivePolicyEntity } from '../governance/entities/effective-policy.entity.js';
import { SloDeclarationEntity } from '../observability/entities/slo-declaration.entity.js';
import { AccessGrantEntity } from '../access/entities/access-grant.entity.js';
import { AccessRequestEntity } from '../access/entities/access-request.entity.js';
import type { AccessRequestStatus } from '@provenance/types';
import { TrustScoreService } from '../trust-score/trust-score.service.js';
import { LineageService } from '../lineage/lineage.service.js';
import { SearchIndexingService } from '../search/search-indexing.service.js';
import { ProductIndexService } from '../search/product-index.service.js';
import { OpaClient } from '../governance/opa/opa-client.js';
import type {
  RoleType,
  PrincipalType,
  PolicyDomain,
  DataClassification,
  PortType,
  OutputPortInterfaceType,
} from '@provenance/types';

// Phase 5.6 — dev-experience seed surface.
//
// Endpoints called by the @provenance/seed package's runner (see
// `packages/seed/src/runner.ts`). The surface is gated by SeedGuard, which
// requires SEED_ENABLED=true plus a constant-time match on
// `x-seed-service-token` against SEED_API_KEY. Production must not enable
// either — the guard returns 404 when SEED_ENABLED is false so a probing
// attacker cannot detect the surface.
//
// Idempotency is via natural-key find-or-create on every endpoint, so the
// seed can be re-run without duplicating data. We deliberately bypass parts
// of the production publish flow that the seed does not need (governance
// pre-checks, lifecycle Kafka events) — the seed payload is authored, not
// user-supplied, and trying to satisfy the full publish flow makes the seed
// brittle to unrelated infrastructure (OPA, broker) being temporarily
// unavailable.

interface SeedOrganizationDto {
  slug: string;
  name: string;
  description?: string | null;
  contactEmail?: string | null;
}

interface SeedDomainDto {
  orgId: string;
  slug: string;
  name: string;
  description?: string | null;
  ownerEmail: string;
}

interface SeedPrincipalDto {
  orgId: string;
  keycloakUserId: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: RoleType[];
  domainSlugs?: string[];
}

interface SeedPolicyDto {
  orgId: string;
  policyKey: string;
  title: string;
  description: string;
  appliesTo: 'platform' | 'domain' | 'product';
  regoModule: string;
}

interface SeedPortDto {
  slug: string;
  type: PortType;
  interfaceType: OutputPortInterfaceType;
  description: string;
  contract: {
    fields: Array<Record<string, unknown>>;
    connectionDetails: Record<string, unknown>;
    howToUse?: string;
  };
}

interface SeedProductDto {
  orgId: string;
  domainSlug: string;
  slug: string;
  name: string;
  description: string;
  ownerEmail: string;
  tags: string[];
  lifecycleState: 'draft' | 'published';
  freshnessSla: string;
  refreshCadence: string;
  ports: SeedPortDto[];
}

interface SeedAgentDto {
  orgId: string;
  agentSlug: string;
  displayName: string;
  description: string;
  trustClassification: 'observed' | 'supervised' | 'autonomous';
  oversightContactEmail: string;
  keycloakClientId: string;
  keycloakClientSecret: string;
}

interface SeedLineageEdgeDto {
  fromProductId: string;
  toProductId: string;
  edgeType: string;
  description: string;
}

interface SeedSloDto {
  orgId: string;
  productId: string;
  name: string;
  description: string;
  sloType: 'freshness' | 'null_rate' | 'latency' | 'completeness' | 'custom';
  metricName: string;
  thresholdOperator: 'lt' | 'lte' | 'gt' | 'gte' | 'eq';
  thresholdValue: number;
  thresholdUnit?: string;
  evaluationWindowHours?: number;
}

interface SeedAccessRequestDto {
  orgId: string;
  productId: string;
  requesterPrincipalId: string;
  justification: string;
  status: AccessRequestStatus;
  requestedAt: string;
  resolvedAt?: string;
  resolvedByPrincipalId?: string;
  resolutionNote?: string;
}

interface SeedAccessGrantDto {
  orgId: string;
  productId: string;
  granteePrincipalId: string;
  grantedByPrincipalId: string;
  grantedAt: string;
  expiresAt?: string;
}

@UseGuards(SeedGuard)
@Controller('seed')
export class SeedController {
  private readonly logger = new Logger(SeedController.name);

  constructor(
    @InjectRepository(OrgEntity) private readonly orgRepo: Repository<OrgEntity>,
    @InjectRepository(DomainEntity) private readonly domainRepo: Repository<DomainEntity>,
    @InjectRepository(PrincipalEntity) private readonly principalRepo: Repository<PrincipalEntity>,
    @InjectRepository(DataProductEntity)
    private readonly productRepo: Repository<DataProductEntity>,
    @InjectRepository(PortDeclarationEntity)
    private readonly portRepo: Repository<PortDeclarationEntity>,
    @InjectRepository(AgentIdentityEntity)
    private readonly agentRepo: Repository<AgentIdentityEntity>,
    @InjectRepository(PolicyVersionEntity)
    private readonly policyVersionRepo: Repository<PolicyVersionEntity>,
    @InjectRepository(EffectivePolicyEntity)
    private readonly effectivePolicyRepo: Repository<EffectivePolicyEntity>,
    @InjectRepository(SloDeclarationEntity)
    private readonly sloDeclRepo: Repository<SloDeclarationEntity>,
    @InjectRepository(AccessGrantEntity)
    private readonly accessGrantRepo: Repository<AccessGrantEntity>,
    @InjectRepository(AccessRequestEntity)
    private readonly accessRequestRepo: Repository<AccessRequestEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly trustScoreService: TrustScoreService,
    private readonly lineageService: LineageService,
    private readonly searchIndexingService: SearchIndexingService,
    private readonly productIndexService: ProductIndexService,
    private readonly opaClient: OpaClient,
  ) {}

  // ---------------------------------------------------------------------------
  // 1. Organizations
  // ---------------------------------------------------------------------------

  @Public()
  @Post('organizations')
  @HttpCode(HttpStatus.OK)
  async organization(@Body() dto: SeedOrganizationDto): Promise<{ id: string; slug: string }> {
    const existing = await this.orgRepo.findOne({ where: { slug: dto.slug } });
    if (existing) return { id: existing.id, slug: existing.slug };

    const saved = await this.orgRepo.save(
      this.orgRepo.create({
        slug: dto.slug,
        name: dto.name,
        description: dto.description ?? null,
        contactEmail: dto.contactEmail ?? null,
        status: 'active',
      }),
    );
    return { id: saved.id, slug: saved.slug };
  }

  // ---------------------------------------------------------------------------
  // 2. Domains
  // ---------------------------------------------------------------------------

  @Public()
  @Post('domains')
  @HttpCode(HttpStatus.OK)
  async domain(@Body() dto: SeedDomainDto): Promise<{ id: string; slug: string }> {
    const existing = await this.domainRepo.findOne({
      where: { orgId: dto.orgId, slug: dto.slug },
    });
    if (existing) return { id: existing.id, slug: existing.slug };

    const owner = await this.principalRepo.findOne({
      where: { orgId: dto.orgId, email: dto.ownerEmail },
    });
    if (!owner) {
      throw new NotFoundException(
        `Domain owner principal not found for email ${dto.ownerEmail} in org ${dto.orgId}. ` +
          'Seed principals before domains.',
      );
    }

    const saved = await this.domainRepo.save(
      this.domainRepo.create({
        orgId: dto.orgId,
        slug: dto.slug,
        name: dto.name,
        description: dto.description ?? null,
        ownerPrincipalId: owner.id,
      }),
    );
    return { id: saved.id, slug: saved.slug };
  }

  // ---------------------------------------------------------------------------
  // 3. Principals
  // ---------------------------------------------------------------------------

  @Public()
  @Post('principals')
  @HttpCode(HttpStatus.OK)
  async principal(@Body() dto: SeedPrincipalDto): Promise<{ id: string }> {
    return this.dataSource.transaction(async (em) => {
      const principalRepo = em.getRepository(PrincipalEntity);
      const roleRepo = em.getRepository(RoleAssignmentEntity);
      const domainRepo = em.getRepository(DomainEntity);

      let principal = await principalRepo.findOne({
        where: { keycloakSubject: dto.keycloakUserId },
      });
      if (!principal) {
        principal = await principalRepo.save(
          principalRepo.create({
            orgId: dto.orgId,
            principalType: 'human_user' as PrincipalType,
            keycloakSubject: dto.keycloakUserId,
            email: dto.email,
            displayName: `${dto.firstName} ${dto.lastName}`,
          }),
        );
      }

      // Resolve domain slugs (for domain_owner role bindings).
      const domainSlugs = dto.domainSlugs ?? [];
      const domains = domainSlugs.length
        ? await domainRepo.find({ where: { orgId: dto.orgId } })
        : [];
      const domainIdBySlug = new Map(domains.map((d) => [d.slug, d.id]));

      for (const inputRole of dto.roles) {
        const role = normalizeRole(inputRole);
        if (role === 'domain_owner') {
          // Bind one role row per domain slug.
          for (const slug of domainSlugs) {
            const domainId = domainIdBySlug.get(slug);
            if (!domainId) continue; // domain not yet seeded — runner ordering will fix on next run
            await this.upsertRole(roleRepo, dto.orgId, principal.id, role, domainId);
          }
        } else {
          await this.upsertRole(roleRepo, dto.orgId, principal.id, role, null);
        }
      }

      return { id: principal.id };
    });
  }

  private async upsertRole(
    repo: Repository<RoleAssignmentEntity>,
    orgId: string,
    principalId: string,
    role: RoleType,
    domainId: string | null,
  ): Promise<void> {
    const existing = await repo.findOne({
      where: {
        orgId,
        principalId,
        role,
        domainId: domainId === null ? IsNull() : domainId,
      },
    });
    if (existing) return;
    await repo.save(
      repo.create({
        orgId,
        principalId,
        role,
        domainId,
        grantedBy: null,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // 4. Policies
  // ---------------------------------------------------------------------------

  @Public()
  @Post('policies')
  @HttpCode(HttpStatus.OK)
  async policy(@Body() dto: SeedPolicyDto): Promise<{ id: string }> {
    // The seed authors raw Rego modules (rather than the structured rule
    // shape `publishPolicyVersion()` expects), so we write the version row
    // directly and push the module to OPA. Failures uploading to OPA are
    // logged but do not abort the seed — the row is still visible in the
    // governance UI and a follow-up `/recompute` or operator can re-push.
    //
    // The DB enforces a CHECK constraint on policy_domain that only allows
    // the platform-level taxonomy values (product_schema, access_control,
    // slo, etc.). Seed policy_keys ("acme.pii-requires-governance-approval"
    // and friends) are name-only labels — map them onto the closest taxonomy
    // bucket for storage. Each seed key gets a unique policy_domain so the
    // (org, policy_domain) uniqueness across rows does not collide.
    const policyDomain = mapSeedPolicyKeyToDomain(dto.policyKey);

    // Look up an org_admin principal as the publisher (published_by is
    // NOT NULL in policy_versions). Fall back to any principal in the org
    // so the seed does not require a specific role to be present yet.
    const publisher =
      (await this.dataSource.query<Array<{ id: string }>>(
        `SELECT p.id FROM identity.principals p
         JOIN identity.role_assignments r ON r.principal_id = p.id
         WHERE p.org_id = $1 AND r.role = 'org_admin'
         LIMIT 1`,
        [dto.orgId],
      ))[0]?.id ??
      (await this.principalRepo.findOne({ where: { orgId: dto.orgId } }))?.id;
    if (!publisher) {
      throw new NotFoundException(
        `No principal found in org ${dto.orgId} to record as policy publisher; seed principals first.`,
      );
    }

    const existing = await this.policyVersionRepo.findOne({
      where: { orgId: dto.orgId, policyDomain },
      order: { versionNumber: 'DESC' },
    });
    if (existing) return { id: existing.id };

    const saved = await this.policyVersionRepo.save(
      this.policyVersionRepo.create({
        orgId: dto.orgId,
        policyDomain,
        versionNumber: 1,
        rules: {
          regoModule: dto.regoModule,
          appliesTo: dto.appliesTo,
          title: dto.title,
          policyKey: dto.policyKey,
        },
        description: dto.description ?? null,
        publishedBy: publisher,
        regoBundleRef: `provenance/${dto.orgId}/${policyDomain}`,
      }),
    );

    const computedRules = {
      regoModule: dto.regoModule,
      appliesTo: dto.appliesTo,
      title: dto.title,
    };
    const existingEffective = await this.effectivePolicyRepo.findOne({
      where: { orgId: dto.orgId, policyDomain, scopeType: 'global_floor', scopeId: IsNull() },
    });
    if (existingEffective) {
      existingEffective.policyVersionId = saved.id;
      existingEffective.computedRules = computedRules;
      existingEffective.computedAt = new Date();
      await this.effectivePolicyRepo.save(existingEffective);
    } else {
      await this.effectivePolicyRepo.save(
        this.effectivePolicyRepo.create({
          orgId: dto.orgId,
          policyDomain,
          scopeType: 'global_floor',
          scopeId: null,
          policyVersionId: saved.id,
          computedRules,
        }),
      );
    }

    try {
      await this.opaClient.upsertPolicy(saved.regoBundleRef!, dto.regoModule);
    } catch (err) {
      this.logger.warn(
        `OPA upsertPolicy failed for ${dto.policyKey}: ${(err as Error).message} — policy stored but not active`,
      );
    }

    return { id: saved.id };
  }

  // ---------------------------------------------------------------------------
  // 5. Products (with publish + indexing)
  // ---------------------------------------------------------------------------

  @Public()
  @Post('products')
  @HttpCode(HttpStatus.OK)
  async product(@Body() dto: SeedProductDto): Promise<{ id: string; slug: string }> {
    // Idempotent on (orgId, domainSlug, slug). Re-running the seed must not
    // duplicate ports either, so we skip port creation if the product is
    // already present.
    const domain = await this.domainRepo.findOne({
      where: { orgId: dto.orgId, slug: dto.domainSlug },
    });
    if (!domain) {
      throw new NotFoundException(
        `Domain '${dto.domainSlug}' not found in org ${dto.orgId}`,
      );
    }
    const owner = await this.principalRepo.findOne({
      where: { orgId: dto.orgId, email: dto.ownerEmail },
    });
    if (!owner) {
      throw new NotFoundException(
        `Product owner principal not found for email ${dto.ownerEmail}`,
      );
    }

    const existing = await this.productRepo.findOne({
      where: { orgId: dto.orgId, domainId: domain.id, slug: dto.slug },
    });
    if (existing) return { id: existing.id, slug: existing.slug };

    // Save product directly with the requested lifecycle state. Bypassing
    // ProductsService.publishProduct skips governance evaluation, lifecycle
    // event emission, and Kafka publication — none of which the seed needs
    // and several of which depend on infrastructure (OPA, broker) being
    // synchronously available. The seed remains visible in PostgreSQL,
    // which drives every read path.
    const product = await this.productRepo.save(
      this.productRepo.create({
        orgId: dto.orgId,
        domainId: domain.id,
        name: dto.name,
        slug: dto.slug,
        description: dto.description,
        classification: this.guessClassification(dto.tags),
        ownerPrincipalId: owner.id,
        tags: dto.tags,
        status: dto.lifecycleState,
        version: dto.lifecycleState === 'published' ? '1.0.0' : '0.1.0',
      }),
    );

    for (const port of dto.ports) {
      const contractSchema = port.contract.fields.length
        ? { type: 'object', properties: this.fieldsToProperties(port.contract.fields) }
        : null;
      await this.portRepo.save(
        this.portRepo.create({
          orgId: dto.orgId,
          productId: product.id,
          portType: port.type,
          name: port.slug,
          description: port.description,
          interfaceType: port.interfaceType,
          contractSchema,
          slaDescription: port.contract.howToUse ?? null,
          // Connection details are stored as plaintext on the seed path —
          // the EncryptionService is only invoked through declarePort(),
          // and the seed values are dev/demo placeholders, not real
          // secrets.
          connectionDetails: port.contract.connectionDetails,
          connectionDetailsEncrypted: false,
          connectionDetailsValidated: false,
        }),
      );
    }

    // Index in both OpenSearch indices so marketplace search and semantic
    // search work after seed (B-009 — synchronous double-write pattern).
    if (dto.lifecycleState === 'published') {
      this.searchIndexingService.indexProduct(product.id, dto.orgId).catch((err) => {
        this.logger.warn(`kNN index failed for ${product.id}: ${(err as Error).message}`);
      });
      this.productIndexService.indexProductById(product.id, dto.orgId).catch((err) => {
        this.logger.warn(`BM25 index failed for ${product.id}: ${(err as Error).message}`);
      });
    }

    return { id: product.id, slug: product.slug };
  }

  // ---------------------------------------------------------------------------
  // 6. Agents
  // ---------------------------------------------------------------------------

  @Public()
  @Post('agents')
  @HttpCode(HttpStatus.OK)
  async agent(@Body() dto: SeedAgentDto): Promise<{ id: string }> {
    // The seed has already created the Keycloak client (see runner.ts
    // step "agents") and passes the resulting clientId/secret. We only
    // need to write the agent identity + initial classification rows.
    const oversightPrincipal = await this.principalRepo.findOne({
      where: { orgId: dto.orgId, email: dto.oversightContactEmail },
    });
    if (!oversightPrincipal) {
      throw new NotFoundException(
        `Oversight contact principal not found for email ${dto.oversightContactEmail}`,
      );
    }

    const existing = await this.agentRepo.findOne({
      where: { orgId: dto.orgId, displayName: dto.displayName },
    });
    if (existing) return { id: existing.agentId };

    return this.dataSource.transaction(async (em) => {
      const agentRepo = em.getRepository(AgentIdentityEntity);
      const classRepo = em.getRepository(AgentTrustClassificationEntity);

      const agent = await agentRepo.save(
        agentRepo.create({
          orgId: dto.orgId,
          displayName: dto.displayName,
          modelName: 'unknown',
          modelProvider: 'unknown',
          humanOversightContact: dto.oversightContactEmail,
          registeredByPrincipalId: oversightPrincipal.id,
          currentClassification: titleCase(dto.trustClassification),
          keycloakClientProvisioned: true,
        }),
      );

      await classRepo.save(
        classRepo.create({
          agentId: agent.agentId,
          orgId: dto.orgId,
          classification: titleCase(dto.trustClassification),
          scope: 'global',
          changedByPrincipalId: oversightPrincipal.id,
          changedByPrincipalType: 'human_user',
          reason: 'Seeded from @provenance/seed',
        }),
      );

      return { id: agent.agentId };
    });
  }

  // ---------------------------------------------------------------------------
  // 7. Lineage edges
  // ---------------------------------------------------------------------------

  @Public()
  @Post('lineage-edges')
  @HttpCode(HttpStatus.OK)
  async lineageEdge(@Body() dto: SeedLineageEdgeDto): Promise<{ id: string }> {
    // The lineage service writes both the emission_log row and the Neo4j
    // edge. We need to know the products' org for context — both products
    // belong to the same org (the seed runner only seeds intra-org edges).
    const fromProduct = await this.productRepo.findOne({ where: { id: dto.fromProductId } });
    const toProduct = await this.productRepo.findOne({ where: { id: dto.toProductId } });
    if (!fromProduct || !toProduct) {
      throw new NotFoundException(
        `Lineage edge endpoints not found: ${dto.fromProductId} -> ${dto.toProductId}`,
      );
    }
    if (fromProduct.orgId !== toProduct.orgId) {
      throw new NotFoundException('Cross-org lineage edges are not supported by the seed');
    }

    const entry = await this.lineageService.emitEvent(fromProduct.orgId, {
      source_node: {
        node_type: 'DataProduct',
        node_id: fromProduct.id,
        org_id: fromProduct.orgId,
        display_name: fromProduct.name,
      },
      target_node: {
        node_type: 'DataProduct',
        node_id: toProduct.id,
        org_id: toProduct.orgId,
        display_name: toProduct.name,
      },
      edge_type: dto.edgeType,
      transformation_logic: dto.description,
      emitted_by: 'seed-runner',
      idempotency_key: `seed:lineage:${fromProduct.id}:${toProduct.id}:${dto.edgeType}`,
    });

    return { id: entry.id };
  }

  // ---------------------------------------------------------------------------
  // 8. SLO declarations
  // ---------------------------------------------------------------------------

  @Public()
  @Post('slos')
  @HttpCode(HttpStatus.OK)
  async slo(@Body() dto: SeedSloDto): Promise<{ id: string }> {
    const product = await this.productRepo.findOne({ where: { id: dto.productId } });
    if (!product) {
      throw new NotFoundException(`SLO product ${dto.productId} not found`);
    }
    if (product.orgId !== dto.orgId) {
      throw new NotFoundException(
        `SLO product ${dto.productId} does not belong to org ${dto.orgId}`,
      );
    }

    // Idempotent on (org_id, product_id, name) — re-running the seed
    // returns the existing declaration without inserting a duplicate.
    const existing = await this.sloDeclRepo.findOne({
      where: { orgId: dto.orgId, productId: dto.productId, name: dto.name },
    });
    if (existing) return { id: existing.id };

    const saved = await this.sloDeclRepo.save(
      this.sloDeclRepo.create({
        orgId: dto.orgId,
        productId: dto.productId,
        name: dto.name,
        description: dto.description,
        sloType: dto.sloType,
        metricName: dto.metricName,
        thresholdOperator: dto.thresholdOperator,
        thresholdValue: dto.thresholdValue,
        thresholdUnit: dto.thresholdUnit ?? null,
        evaluationWindowHours: dto.evaluationWindowHours ?? 24,
        active: true,
      }),
    );
    return { id: saved.id };
  }

  // ---------------------------------------------------------------------------
  // 9. Access requests (cross-domain within an org)
  // ---------------------------------------------------------------------------

  @Public()
  @Post('access-requests')
  @HttpCode(HttpStatus.OK)
  async accessRequest(@Body() dto: SeedAccessRequestDto): Promise<{ id: string }> {
    const product = await this.productRepo.findOne({ where: { id: dto.productId } });
    if (!product) {
      throw new NotFoundException(`Access request product ${dto.productId} not found`);
    }
    if (product.orgId !== dto.orgId) {
      throw new NotFoundException(
        `Cross-org access requests are not supported by the seed (product ${dto.productId})`,
      );
    }

    // Idempotent on (org, product, requester) — re-running the seed
    // returns whatever row already exists regardless of its current
    // status. Seed never declares more than one request per requester
    // per product.
    const existing = await this.accessRequestRepo.findOne({
      where: {
        orgId: dto.orgId,
        productId: dto.productId,
        requesterPrincipalId: dto.requesterPrincipalId,
      },
    });
    if (existing) return { id: existing.id };

    const requestedAt = new Date(dto.requestedAt);
    const saved = await this.accessRequestRepo.save(
      this.accessRequestRepo.create({
        orgId: dto.orgId,
        productId: dto.productId,
        requesterPrincipalId: dto.requesterPrincipalId,
        justification: dto.justification,
        status: dto.status,
        requestedAt,
        resolvedAt: dto.resolvedAt ? new Date(dto.resolvedAt) : null,
        resolvedBy: dto.resolvedByPrincipalId ?? null,
        resolutionNote: dto.resolutionNote ?? null,
      }),
    );
    // requestedAt is on a CreateDateColumn — TypeORM ignores the value
    // we passed and stamps "now". Force-update to make seed timestamps
    // realistic so SLA badges (F11.9 / F11.10) demo correctly.
    await this.accessRequestRepo.update(saved.id, { requestedAt });
    return { id: saved.id };
  }

  // ---------------------------------------------------------------------------
  // 10. Access grants
  // ---------------------------------------------------------------------------

  @Public()
  @Post('access-grants')
  @HttpCode(HttpStatus.OK)
  async accessGrant(@Body() dto: SeedAccessGrantDto): Promise<{ id: string }> {
    const product = await this.productRepo.findOne({ where: { id: dto.productId } });
    if (!product) {
      throw new NotFoundException(`Access grant product ${dto.productId} not found`);
    }
    if (product.orgId !== dto.orgId) {
      throw new NotFoundException(
        `Cross-org access grants are not supported by the seed (product ${dto.productId})`,
      );
    }

    // Idempotent on (org, product, grantee) where revoked_at IS NULL.
    // A grant that was previously seeded and then revoked by hand will
    // be re-seeded on next run — that matches the semantic that
    // re-seeding restores demo state.
    const existing = await this.accessGrantRepo.findOne({
      where: {
        orgId: dto.orgId,
        productId: dto.productId,
        granteePrincipalId: dto.granteePrincipalId,
        revokedAt: IsNull(),
      },
    });
    if (existing) return { id: existing.id };

    const grantedAt = new Date(dto.grantedAt);
    const saved = await this.accessGrantRepo.save(
      this.accessGrantRepo.create({
        orgId: dto.orgId,
        productId: dto.productId,
        granteePrincipalId: dto.granteePrincipalId,
        grantedBy: dto.grantedByPrincipalId,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        revokedAt: null,
        revokedBy: null,
        accessScope: null,
        approvalRequestId: null,
        connectionPackage: null,
        expiryWarningSentAt: null,
      }),
    );
    // grantedAt is on a CreateDateColumn — same pattern as access requests.
    await this.accessGrantRepo.update(saved.id, { grantedAt });
    return { id: saved.id };
  }

  // ---------------------------------------------------------------------------
  // 11. Trust score recompute
  // ---------------------------------------------------------------------------

  @Public()
  @Post('trust-score-recompute/:productId')
  @HttpCode(HttpStatus.OK)
  async trustScoreRecompute(@Param('productId') productId: string): Promise<{ score: number }> {
    const product = await this.productRepo.findOne({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException(`Product ${productId} not found`);
    }
    const result = await this.trustScoreService.recompute(product.orgId, productId);
    return { score: result.score };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private guessClassification(tags: string[]): DataClassification {
    if (tags.includes('pii') || tags.includes('phi')) return 'restricted';
    if (tags.includes('confidential')) return 'confidential';
    if (tags.includes('public')) return 'public';
    return 'internal';
  }

  private fieldsToProperties(
    fields: Array<Record<string, unknown>>,
  ): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const field of fields) {
      const name = String(field['name'] ?? '');
      if (!name) continue;
      out[name] = {
        type: String(field['type'] ?? 'string'),
        description: String(field['description'] ?? ''),
      };
    }
    return out;
  }
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// The seed types use shorthand role names; the DB enforces the canonical
// names from the role_assignments_role_check CHECK constraint. Map the
// shorthands here rather than forcing the seed authors to remember which
// is which.
function normalizeRole(role: string): RoleType {
  if (role === 'governance') return 'governance_member' as RoleType;
  return role as RoleType;
}

// The seed policies use descriptive policy_keys (e.g.
// "acme.pii-requires-governance-approval") that are NOT in the DB's
// policy_domain taxonomy. Map each seed key onto the closest taxonomy
// bucket so the row inserts cleanly. The original policy_key is retained
// inside `rules` for governance UI display.
function mapSeedPolicyKeyToDomain(policyKey: string): PolicyDomain {
  const k = policyKey.toLowerCase();
  if (k.includes('agent') || k.includes('autonomous')) return 'agent_access' as PolicyDomain;
  if (k.includes('freshness') || k.includes('sla')) return 'slo' as PolicyDomain;
  if (k.includes('schema') || k.includes('contract')) return 'product_schema' as PolicyDomain;
  if (k.includes('classification') || k.includes('taxonomy')) {
    return 'classification_taxonomy' as PolicyDomain;
  }
  if (k.includes('lineage')) return 'lineage' as PolicyDomain;
  if (k.includes('version') || k.includes('deprecation')) {
    return 'versioning_deprecation' as PolicyDomain;
  }
  if (k.includes('interop')) return 'interoperability' as PolicyDomain;
  return 'access_control' as PolicyDomain;
}
