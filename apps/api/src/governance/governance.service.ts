import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { PolicySchemaEntity } from './entities/policy-schema.entity.js';
import { PolicyVersionEntity } from './entities/policy-version.entity.js';
import { EffectivePolicyEntity } from './entities/effective-policy.entity.js';
import { ComplianceStateEntity } from './entities/compliance-state.entity.js';
import { ExceptionEntity } from './entities/exception.entity.js';
import { GracePeriodEntity } from './entities/grace-period.entity.js';
import { OpaClient } from './opa/opa-client.js';
import { RegoCompiler } from './compilation/rego-compiler.js';
import type {
  PolicyDomain,
  PolicySchema,
  PolicySchemaList,
  PolicyVersion,
  PolicyVersionList,
  PublishPolicyRequest,
  PolicyImpactPreview,
  PolicyImpactPreviewRequest,
  EffectivePolicy,
  EffectivePolicyList,
  ComplianceState,
  ComplianceStateList,
  ComplianceStateValue,
  ComplianceViolation,
  EvaluationResult,
  TriggerEvaluationRequest,
  Exception,
  ExceptionList,
  GrantExceptionRequest,
  GracePeriod,
  GracePeriodList,
  GracePeriodOutcome,
  DataProduct,
} from '@provenance/types';

@Injectable()
export class GovernanceService {
  constructor(
    @InjectRepository(PolicySchemaEntity)
    private readonly policySchemaRepo: Repository<PolicySchemaEntity>,
    @InjectRepository(PolicyVersionEntity)
    private readonly policyVersionRepo: Repository<PolicyVersionEntity>,
    @InjectRepository(EffectivePolicyEntity)
    private readonly effectivePolicyRepo: Repository<EffectivePolicyEntity>,
    @InjectRepository(ComplianceStateEntity)
    private readonly complianceStateRepo: Repository<ComplianceStateEntity>,
    @InjectRepository(ExceptionEntity)
    private readonly exceptionRepo: Repository<ExceptionEntity>,
    @InjectRepository(GracePeriodEntity)
    private readonly gracePeriodRepo: Repository<GracePeriodEntity>,
    private readonly opaClient: OpaClient,
    private readonly regoCompiler: RegoCompiler,
  ) {}

  // ---------------------------------------------------------------------------
  // Policy Schemas
  // ---------------------------------------------------------------------------

  async listPolicySchemas(
    orgId: string,
    policyDomain?: PolicyDomain,
  ): Promise<PolicySchemaList> {
    const where = policyDomain ? { orgId, policyDomain } : { orgId };
    const [items, total] = await this.policySchemaRepo.findAndCount({
      where,
      order: { policyDomain: 'ASC' },
    });
    return {
      items: items.map((i) => this.toPolicySchema(i)),
      meta: { total, limit: total, offset: 0 },
    };
  }

  async getPolicySchemaByDomain(
    orgId: string,
    policyDomain: PolicyDomain,
  ): Promise<PolicySchema> {
    const schema = await this.policySchemaRepo.findOne({ where: { orgId, policyDomain } });
    if (!schema) throw new NotFoundException(`Policy schema for domain '${policyDomain}' not found`);
    return this.toPolicySchema(schema);
  }

  // ---------------------------------------------------------------------------
  // Policy Versions
  // ---------------------------------------------------------------------------

  async listPolicyVersions(
    orgId: string,
    limit: number,
    offset: number,
    policyDomain?: PolicyDomain,
  ): Promise<PolicyVersionList> {
    const where = policyDomain ? { orgId, policyDomain } : { orgId };
    const [items, total] = await this.policyVersionRepo.findAndCount({
      where,
      order: { publishedAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return {
      items: items.map((i) => this.toPolicyVersion(i)),
      meta: { total, limit, offset },
    };
  }

  async getPolicyVersion(orgId: string, versionId: string): Promise<PolicyVersion> {
    const version = await this.policyVersionRepo.findOne({ where: { id: versionId, orgId } });
    if (!version) throw new NotFoundException(`Policy version ${versionId} not found`);
    return this.toPolicyVersion(version);
  }

  /**
   * Publish a new policy version.
   *
   * Pipeline:
   *   1. Increment version_number per (org, domain)
   *   2. Persist the policy version record
   *   3. Compile rules JSON → Rego via RegoCompiler
   *   4. Upload Rego to OPA via OpaClient.upsertPolicy()
   *   5. Update rego_bundle_ref on the version record
   *   6. Upsert the effective_policies row for this org+domain
   */
  async publishPolicyVersion(
    orgId: string,
    dto: PublishPolicyRequest,
    publishedBy: string,
  ): Promise<PolicyVersion> {
    // Step 1: next version number
    const maxResult = await this.policyVersionRepo
      .createQueryBuilder('pv')
      .select('MAX(pv.version_number)', 'max')
      .where('pv.org_id = :orgId AND pv.policy_domain = :domain', {
        orgId,
        domain: dto.policyDomain,
      })
      .getRawOne<{ max: number | null }>();

    const versionNumber = (maxResult?.max ?? 0) + 1;

    // Step 2: persist
    const version = this.policyVersionRepo.create({
      orgId,
      policyDomain: dto.policyDomain,
      versionNumber,
      rules: dto.rules,
      description: dto.description ?? null,
      publishedBy,
    });
    const saved = await this.policyVersionRepo.save(version);

    // Steps 3–4: compile and upload to OPA
    const regoText = this.regoCompiler.compile(orgId, dto.policyDomain, dto.rules);
    const policyId = RegoCompiler.policyId(orgId, dto.policyDomain);
    await this.opaClient.upsertPolicy(policyId, regoText);

    // Step 5: update rego_bundle_ref
    saved.regoBundleRef = policyId;
    await this.policyVersionRepo.save(saved);

    // Step 6: upsert effective policy
    await this.upsertEffectivePolicy(orgId, dto.policyDomain, saved.id, dto.rules);

    return this.toPolicyVersion(saved);
  }

  // ---------------------------------------------------------------------------
  // Policy Impact Preview
  // ---------------------------------------------------------------------------

  /**
   * Preview the compliance impact of a proposed policy change.
   * Validates the rules compile to valid Rego and returns impact metadata.
   * Full product re-evaluation is deferred to a future implementation.
   */
  async previewImpact(
    orgId: string,
    dto: PolicyImpactPreviewRequest,
  ): Promise<PolicyImpactPreview> {
    // Validate by compiling — throws if rules are structurally invalid.
    const regoText = this.regoCompiler.compile(orgId, dto.policyDomain, dto.rules);

    // Upload as a temporary policy, then clean up. Validates OPA can parse the Rego.
    const tempPolicyId = `provenance_governance_preview_${orgId.replace(/-/g, '')}_${Date.now()}`;
    await this.opaClient.upsertPolicy(tempPolicyId, regoText);
    await this.opaClient.deletePolicy(tempPolicyId);

    return {
      policyDomain: dto.policyDomain,
      totalProducts: 0,
      impactedProducts: [],
      newViolationCount: 0,
      resolvedViolationCount: 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Effective Policies
  // ---------------------------------------------------------------------------

  async listEffectivePolicies(
    orgId: string,
    scopeType?: string,
  ): Promise<EffectivePolicyList> {
    const where = scopeType ? { orgId, scopeType: scopeType as 'global_floor' | 'domain_extension' } : { orgId };
    const [items, total] = await this.effectivePolicyRepo.findAndCount({
      where,
      order: { policyDomain: 'ASC' },
    });
    return {
      items: items.map((i) => this.toEffectivePolicy(i)),
      meta: { total, limit: total, offset: 0 },
    };
  }

  async getEffectivePolicyByDomain(
    orgId: string,
    policyDomain: PolicyDomain,
  ): Promise<EffectivePolicy> {
    const policy = await this.effectivePolicyRepo.findOne({
      where: { orgId, policyDomain, scopeType: 'global_floor', scopeId: IsNull() },
    });
    if (!policy) throw new NotFoundException(`Effective policy for domain '${policyDomain}' not found`);
    return this.toEffectivePolicy(policy);
  }

  // ---------------------------------------------------------------------------
  // Compliance
  // ---------------------------------------------------------------------------

  async listComplianceStates(
    orgId: string,
    limit: number,
    offset: number,
    state?: ComplianceStateValue,
    _domainId?: string,
  ): Promise<ComplianceStateList> {
    // domainId filter not available on compliance_states directly — filtering
    // by domain requires a join with data_products, deferred to Phase 3.
    const where = state ? { orgId, state } : { orgId };
    const [items, total] = await this.complianceStateRepo.findAndCount({
      where,
      order: { evaluatedAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return {
      items: items.map((i) => this.toComplianceState(i)),
      meta: { total, limit, offset },
    };
  }

  async getComplianceStateByProduct(
    orgId: string,
    productId: string,
  ): Promise<ComplianceState> {
    const cs = await this.complianceStateRepo.findOne({ where: { orgId, productId } });
    if (!cs) throw new NotFoundException(`No compliance state found for product ${productId}`);
    return this.toComplianceState(cs);
  }

  async triggerEvaluation(
    orgId: string,
    dto: TriggerEvaluationRequest,
  ): Promise<EvaluationResult> {
    // Admin trigger — returns aggregate counts for the scope.
    // Full re-evaluation requires product enumeration, deferred to Phase 3.
    // Returns current aggregate from compliance_states.
    const where = dto.productId
      ? { orgId, productId: dto.productId }
      : { orgId };
    const states = await this.complianceStateRepo.find({ where });
    return {
      evaluated: states.length,
      compliant: states.filter((s) => s.state === 'compliant').length,
      nonCompliant: states.filter((s) => s.state === 'non_compliant').length,
      driftDetected: states.filter((s) => s.state === 'drift_detected').length,
      gracePeriod: states.filter((s) => s.state === 'grace_period').length,
      violations: [],
    };
  }

  /**
   * Evaluate a product against all effective policies for its org.
   * Called by ProductsService at publish time.
   *
   * - Queries OPA for each active global_floor policy domain
   * - Aggregates violations across all domains
   * - Upserts the compliance_states row for this product
   * - Returns the evaluation summary
   */
  async evaluate(orgId: string, product: DataProduct): Promise<EvaluationResult> {
    const effectivePolicies = await this.effectivePolicyRepo.find({
      where: { orgId, scopeType: 'global_floor' },
    });

    if (effectivePolicies.length === 0) {
      await this.upsertComplianceState(orgId, product.id, 'compliant', [], null);
      return { evaluated: 1, compliant: 1, nonCompliant: 0, driftDetected: 0, gracePeriod: 0, violations: [] };
    }

    const allViolations: ComplianceViolation[] = [];
    let latestPolicyVersionId: string | null = null;

    for (const policy of effectivePolicies) {
      latestPolicyVersionId = policy.policyVersionId;
      const violationsPath = RegoCompiler.violationsPath(orgId, policy.policyDomain);

      const violations = (await this.opaClient.evaluate<ComplianceViolation[]>(
        violationsPath,
        { product },
      )) ?? [];

      allViolations.push(...violations);
    }

    const state: ComplianceStateValue =
      allViolations.length > 0 ? 'non_compliant' : 'compliant';

    await this.upsertComplianceState(
      orgId,
      product.id,
      state,
      allViolations,
      latestPolicyVersionId,
    );

    return {
      evaluated: 1,
      compliant: allViolations.length === 0 ? 1 : 0,
      nonCompliant: allViolations.length > 0 ? 1 : 0,
      driftDetected: 0,
      gracePeriod: 0,
      violations: allViolations,
    };
  }

  // ---------------------------------------------------------------------------
  // Exceptions
  // ---------------------------------------------------------------------------

  async listExceptions(
    orgId: string,
    limit: number,
    offset: number,
    productId?: string,
  ): Promise<ExceptionList> {
    const where = productId ? { orgId, productId } : { orgId };
    const [items, total] = await this.exceptionRepo.findAndCount({
      where,
      order: { grantedAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return {
      items: items.map((i) => this.toException(i)),
      meta: { total, limit, offset },
    };
  }

  async grantException(
    orgId: string,
    dto: GrantExceptionRequest,
    grantedBy: string,
  ): Promise<Exception> {
    const entity = this.exceptionRepo.create({
      orgId,
      productId: dto.productId,
      policyDomain: dto.policyDomain,
      policyVersionId: dto.policyVersionId ?? null,
      exceptionReason: dto.exceptionReason,
      grantedBy,
      expiresAt: new Date(dto.expiresAt),
      revokedAt: null,
      revokedBy: null,
    });
    const saved = await this.exceptionRepo.save(entity);
    return this.toException(saved);
  }

  async getException(orgId: string, exceptionId: string): Promise<Exception> {
    const entity = await this.exceptionRepo.findOne({ where: { id: exceptionId, orgId } });
    if (!entity) throw new NotFoundException(`Exception ${exceptionId} not found`);
    return this.toException(entity);
  }

  async revokeException(
    orgId: string,
    exceptionId: string,
    revokedBy: string,
  ): Promise<Exception> {
    const entity = await this.exceptionRepo.findOne({ where: { id: exceptionId, orgId } });
    if (!entity) throw new NotFoundException(`Exception ${exceptionId} not found`);
    if (entity.revokedAt) {
      // Idempotent — already revoked
      return this.toException(entity);
    }
    entity.revokedAt = new Date();
    entity.revokedBy = revokedBy;
    const saved = await this.exceptionRepo.save(entity);
    return this.toException(saved);
  }

  // ---------------------------------------------------------------------------
  // Grace Periods
  // ---------------------------------------------------------------------------

  async listGracePeriods(
    orgId: string,
    limit: number,
    offset: number,
    outcome?: GracePeriodOutcome,
  ): Promise<GracePeriodList> {
    const where = outcome ? { orgId, outcome } : { orgId };
    const [items, total] = await this.gracePeriodRepo.findAndCount({
      where,
      order: { startedAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return {
      items: items.map((i) => this.toGracePeriod(i)),
      meta: { total, limit, offset },
    };
  }

  async getGracePeriod(orgId: string, gracePeriodId: string): Promise<GracePeriod> {
    const entity = await this.gracePeriodRepo.findOne({ where: { id: gracePeriodId, orgId } });
    if (!entity) throw new NotFoundException(`Grace period ${gracePeriodId} not found`);
    return this.toGracePeriod(entity);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async upsertEffectivePolicy(
    orgId: string,
    policyDomain: PolicyDomain,
    policyVersionId: string,
    computedRules: Record<string, unknown>,
  ): Promise<void> {
    const existing = await this.effectivePolicyRepo.findOne({
      where: { orgId, policyDomain, scopeType: 'global_floor', scopeId: IsNull() },
    });
    if (existing) {
      existing.policyVersionId = policyVersionId;
      existing.computedRules = computedRules;
      existing.computedAt = new Date();
      await this.effectivePolicyRepo.save(existing);
    } else {
      await this.effectivePolicyRepo.save(
        this.effectivePolicyRepo.create({
          orgId,
          policyDomain,
          scopeType: 'global_floor',
          scopeId: null,
          policyVersionId,
          computedRules,
          computedAt: new Date(),
        }),
      );
    }
  }

  private async upsertComplianceState(
    orgId: string,
    productId: string,
    state: ComplianceStateValue,
    violations: ComplianceViolation[],
    policyVersionId: string | null,
  ): Promise<void> {
    const existing = await this.complianceStateRepo.findOne({ where: { orgId, productId } });
    if (existing) {
      existing.state = state;
      existing.violations = violations;
      existing.policyVersionId = policyVersionId;
      existing.evaluatedAt = new Date();
      await this.complianceStateRepo.save(existing);
    } else {
      await this.complianceStateRepo.save(
        this.complianceStateRepo.create({
          orgId,
          productId,
          state,
          violations,
          policyVersionId,
          evaluatedAt: new Date(),
          nextEvaluationAt: null,
        }),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Mappers
  // ---------------------------------------------------------------------------

  private toPolicySchema(e: PolicySchemaEntity): PolicySchema {
    return {
      id: e.id,
      orgId: e.orgId,
      policyDomain: e.policyDomain,
      schemaVersion: e.schemaVersion,
      schemaDefinition: e.schemaDefinition,
      isPlatformDefault: e.isPlatformDefault,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    };
  }

  private toPolicyVersion(e: PolicyVersionEntity): PolicyVersion {
    return {
      id: e.id,
      orgId: e.orgId,
      policyDomain: e.policyDomain,
      versionNumber: e.versionNumber,
      rules: e.rules,
      description: e.description,
      publishedBy: e.publishedBy,
      publishedAt: e.publishedAt.toISOString(),
      regoBundleRef: e.regoBundleRef,
    };
  }

  private toEffectivePolicy(e: EffectivePolicyEntity): EffectivePolicy {
    return {
      id: e.id,
      orgId: e.orgId,
      policyDomain: e.policyDomain,
      scopeType: e.scopeType,
      scopeId: e.scopeId,
      policyVersionId: e.policyVersionId,
      computedRules: e.computedRules,
      computedAt: e.computedAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    };
  }

  private toComplianceState(e: ComplianceStateEntity): ComplianceState {
    return {
      id: e.id,
      orgId: e.orgId,
      productId: e.productId,
      state: e.state,
      violations: e.violations,
      policyVersionId: e.policyVersionId,
      evaluatedAt: e.evaluatedAt.toISOString(),
      nextEvaluationAt: e.nextEvaluationAt ? e.nextEvaluationAt.toISOString() : null,
      updatedAt: e.updatedAt.toISOString(),
    };
  }

  private toException(e: ExceptionEntity): Exception {
    return {
      id: e.id,
      orgId: e.orgId,
      productId: e.productId,
      policyDomain: e.policyDomain,
      policyVersionId: e.policyVersionId,
      exceptionReason: e.exceptionReason,
      grantedBy: e.grantedBy,
      grantedAt: e.grantedAt.toISOString(),
      expiresAt: e.expiresAt.toISOString(),
      revokedAt: e.revokedAt ? e.revokedAt.toISOString() : null,
      revokedBy: e.revokedBy,
      updatedAt: e.updatedAt.toISOString(),
    };
  }

  private toGracePeriod(e: GracePeriodEntity): GracePeriod {
    return {
      id: e.id,
      orgId: e.orgId,
      productId: e.productId,
      policyDomain: e.policyDomain,
      policyVersionId: e.policyVersionId,
      endsAt: e.endsAt.toISOString(),
      temporalWorkflowId: e.temporalWorkflowId,
      startedAt: e.startedAt.toISOString(),
      endedAt: e.endedAt ? e.endedAt.toISOString() : null,
      outcome: e.outcome,
      updatedAt: e.updatedAt.toISOString(),
    };
  }
}
