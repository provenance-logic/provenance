import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { GovernanceService } from '../governance.service.js';
import { PolicySchemaEntity } from '../entities/policy-schema.entity.js';
import { PolicyVersionEntity } from '../entities/policy-version.entity.js';
import { EffectivePolicyEntity } from '../entities/effective-policy.entity.js';
import { ComplianceStateEntity } from '../entities/compliance-state.entity.js';
import { ExceptionEntity } from '../entities/exception.entity.js';
import { GracePeriodEntity } from '../entities/grace-period.entity.js';
import { DataProductEntity } from '../../products/entities/data-product.entity.js';
import { DomainEntity } from '../../organizations/entities/domain.entity.js';
import { OpaClient } from '../opa/opa-client.js';
import { RegoCompiler } from '../compilation/rego-compiler.js';
import type { DataProduct } from '@provenance/types';

// ---------------------------------------------------------------------------
// Repository mock factories
// ---------------------------------------------------------------------------

const mockRepo = () => ({
  findAndCount: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue({ max: null }),
  }),
});

const mockOpaClient = () => ({
  upsertPolicy: jest.fn().mockResolvedValue(undefined),
  evaluate: jest.fn().mockResolvedValue([]),
  deletePolicy: jest.fn().mockResolvedValue(undefined),
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = new Date('2024-01-01T00:00:00Z');

const makeProduct = (overrides: Partial<DataProduct> = {}): DataProduct => ({
  id: 'product-1',
  orgId: 'org-1',
  domainId: 'domain-1',
  name: 'Orders',
  slug: 'orders',
  description: 'Order data product',
  status: 'published',
  version: '1.0.0',
  classification: 'internal',
  ownerPrincipalId: 'principal-1',
  tags: [],
  ports: [],
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  ...overrides,
});

const makeEffectivePolicyEntity = (
  domain: string,
  policyVersionId = 'pv-1',
): EffectivePolicyEntity => ({
  id: `ep-${domain}`,
  orgId: 'org-1',
  policyDomain: domain as any,
  scopeType: 'global_floor',
  scopeId: null,
  policyVersionId,
  computedRules: { rules: [] },
  computedAt: now,
  updatedAt: now,
});

const makeComplianceStateEntity = (
  state = 'compliant',
): ComplianceStateEntity => ({
  id: 'cs-1',
  orgId: 'org-1',
  productId: 'product-1',
  state: state as any,
  violations: [],
  policyVersionId: null,
  evaluatedAt: now,
  nextEvaluationAt: null,
  updatedAt: now,
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('GovernanceService', () => {
  let service: GovernanceService;
  let policyVersionRepo: ReturnType<typeof mockRepo>;
  let effectivePolicyRepo: ReturnType<typeof mockRepo>;
  let complianceStateRepo: ReturnType<typeof mockRepo>;
  let exceptionRepo: ReturnType<typeof mockRepo>;
  let opaClient: ReturnType<typeof mockOpaClient>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        GovernanceService,
        { provide: getRepositoryToken(PolicySchemaEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(PolicyVersionEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(EffectivePolicyEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(ComplianceStateEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(ExceptionEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(GracePeriodEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(DataProductEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(DomainEntity), useFactory: mockRepo },
        { provide: OpaClient, useFactory: mockOpaClient },
        RegoCompiler,
      ],
    }).compile();

    service = module.get(GovernanceService);
    policyVersionRepo = module.get(getRepositoryToken(PolicyVersionEntity));
    effectivePolicyRepo = module.get(getRepositoryToken(EffectivePolicyEntity));
    complianceStateRepo = module.get(getRepositoryToken(ComplianceStateEntity));
    exceptionRepo = module.get(getRepositoryToken(ExceptionEntity));
    opaClient = module.get(OpaClient);
  });

  // ---------------------------------------------------------------------------
  // evaluate()
  // ---------------------------------------------------------------------------

  describe('evaluate()', () => {
    it('returns compliant and upserts compliance state when no effective policies exist', async () => {
      effectivePolicyRepo.find.mockResolvedValue([]);
      complianceStateRepo.findOne.mockResolvedValue(null);
      complianceStateRepo.create.mockImplementation((data: any) => data);
      complianceStateRepo.save.mockResolvedValue({});

      const result = await service.evaluate('org-1', makeProduct());

      expect(result).toEqual({
        evaluated: 1,
        compliant: 1,
        nonCompliant: 0,
        driftDetected: 0,
        gracePeriod: 0,
        violations: [],
      });
      expect(opaClient.evaluate).not.toHaveBeenCalled();
      expect(complianceStateRepo.save).toHaveBeenCalled();
    });

    it('calls OPA for each effective policy domain', async () => {
      effectivePolicyRepo.find.mockResolvedValue([
        makeEffectivePolicyEntity('product_schema', 'pv-1'),
        makeEffectivePolicyEntity('access_control', 'pv-2'),
      ]);
      opaClient.evaluate.mockResolvedValue([]);
      complianceStateRepo.findOne.mockResolvedValue(null);
      complianceStateRepo.create.mockImplementation((data: any) => data);
      complianceStateRepo.save.mockResolvedValue({});

      await service.evaluate('org-1', makeProduct());

      expect(opaClient.evaluate).toHaveBeenCalledTimes(2);
      expect(opaClient.evaluate).toHaveBeenCalledWith(
        expect.stringContaining('product_schema'),
        expect.objectContaining({ product: expect.any(Object) }),
      );
      expect(opaClient.evaluate).toHaveBeenCalledWith(
        expect.stringContaining('access_control'),
        expect.objectContaining({ product: expect.any(Object) }),
      );
    });

    it('aggregates violations from multiple policy domains', async () => {
      effectivePolicyRepo.find.mockResolvedValue([
        makeEffectivePolicyEntity('product_schema'),
        makeEffectivePolicyEntity('access_control'),
      ]);
      opaClient.evaluate
        .mockResolvedValueOnce([
          { rule_id: 'require_output_port', detail: 'missing port', policyDomain: 'product_schema' },
        ])
        .mockResolvedValueOnce([
          { rule_id: 'require_classification', detail: 'public not allowed', policyDomain: 'access_control' },
        ]);
      complianceStateRepo.findOne.mockResolvedValue(null);
      complianceStateRepo.create.mockImplementation((data: any) => data);
      complianceStateRepo.save.mockResolvedValue({});

      const result = await service.evaluate('org-1', makeProduct());

      expect(result.nonCompliant).toBe(1);
      expect(result.compliant).toBe(0);
      // Verify the compliance state was saved with both violations
      expect(complianceStateRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'non_compliant',
          violations: expect.arrayContaining([
            expect.objectContaining({ rule_id: 'require_output_port' }),
            expect.objectContaining({ rule_id: 'require_classification' }),
          ]),
        }),
      );
    });

    it('upserts compliance state as non_compliant when violations exist', async () => {
      effectivePolicyRepo.find.mockResolvedValue([
        makeEffectivePolicyEntity('product_schema', 'pv-1'),
      ]);
      opaClient.evaluate.mockResolvedValue([
        { rule_id: 'require_output_port', detail: 'no output port', policyDomain: 'product_schema' },
      ]);
      complianceStateRepo.findOne.mockResolvedValue(null);
      complianceStateRepo.create.mockImplementation((data: any) => data);
      complianceStateRepo.save.mockResolvedValue({});

      await service.evaluate('org-1', makeProduct());

      expect(complianceStateRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'non_compliant' }),
      );
    });

    it('upserts compliance state as compliant when OPA returns no violations', async () => {
      effectivePolicyRepo.find.mockResolvedValue([
        makeEffectivePolicyEntity('product_schema', 'pv-1'),
      ]);
      opaClient.evaluate.mockResolvedValue([]);
      complianceStateRepo.findOne.mockResolvedValue(null);
      complianceStateRepo.create.mockImplementation((data: any) => data);
      complianceStateRepo.save.mockResolvedValue({});

      await service.evaluate('org-1', makeProduct());

      expect(complianceStateRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'compliant' }),
      );
    });

    it('updates an existing compliance state record rather than creating a new one', async () => {
      effectivePolicyRepo.find.mockResolvedValue([
        makeEffectivePolicyEntity('product_schema'),
      ]);
      opaClient.evaluate.mockResolvedValue([]);
      const existing = makeComplianceStateEntity('non_compliant');
      complianceStateRepo.findOne.mockResolvedValue(existing);
      complianceStateRepo.save.mockResolvedValue(existing);

      await service.evaluate('org-1', makeProduct());

      expect(complianceStateRepo.create).not.toHaveBeenCalled();
      expect(complianceStateRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'compliant' }),
      );
    });

    it('treats undefined OPA response (path not found) as empty violations', async () => {
      effectivePolicyRepo.find.mockResolvedValue([
        makeEffectivePolicyEntity('product_schema'),
      ]);
      opaClient.evaluate.mockResolvedValue(undefined);
      complianceStateRepo.findOne.mockResolvedValue(null);
      complianceStateRepo.create.mockImplementation((data: any) => data);
      complianceStateRepo.save.mockResolvedValue({});

      const result = await service.evaluate('org-1', makeProduct());
      expect(result.compliant).toBe(1);
    });

    it('returns violations array in the result when OPA reports violations', async () => {
      const violation = {
        rule_id: 'require_output_port',
        detail: 'no output port declared',
        policyDomain: 'product_schema',
      };
      effectivePolicyRepo.find.mockResolvedValue([
        makeEffectivePolicyEntity('product_schema'),
      ]);
      opaClient.evaluate.mockResolvedValue([violation]);
      complianceStateRepo.findOne.mockResolvedValue(null);
      complianceStateRepo.create.mockImplementation((data: any) => data);
      complianceStateRepo.save.mockResolvedValue({});

      const result = await service.evaluate('org-1', makeProduct());
      expect(result.violations).toEqual([violation]);
    });
  });

  // ---------------------------------------------------------------------------
  // publishPolicyVersion()
  // ---------------------------------------------------------------------------

  describe('publishPolicyVersion()', () => {
    const dto = {
      policyDomain: 'product_schema' as const,
      rules: {
        rules: [
          {
            id: 'require_output_port',
            type: 'require_port_type',
            config: { portType: 'output', minCount: 1 },
          },
        ],
      },
    };

    beforeEach(() => {
      // version number query
      policyVersionRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ max: 2 }),
      });
      const savedVersion = {
        id: 'pv-new',
        orgId: 'org-1',
        policyDomain: 'product_schema',
        versionNumber: 3,
        rules: dto.rules,
        description: null,
        publishedBy: 'principal-1',
        publishedAt: now,
        regoBundleRef: null,
      };
      policyVersionRepo.create.mockReturnValue(savedVersion);
      policyVersionRepo.save.mockResolvedValue(savedVersion);
      effectivePolicyRepo.findOne.mockResolvedValue(null);
      effectivePolicyRepo.create.mockImplementation((data: any) => data);
      effectivePolicyRepo.save.mockResolvedValue({});
    });

    it('increments the version number from the existing max', async () => {
      await service.publishPolicyVersion('org-1', dto, 'principal-1');
      expect(policyVersionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ versionNumber: 3 }),
      );
    });

    it('starts at version 1 when no previous versions exist', async () => {
      policyVersionRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ max: null }),
      });

      await service.publishPolicyVersion('org-1', dto, 'principal-1');
      expect(policyVersionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ versionNumber: 1 }),
      );
    });

    it('uploads compiled Rego to OPA', async () => {
      await service.publishPolicyVersion('org-1', dto, 'principal-1');
      expect(opaClient.upsertPolicy).toHaveBeenCalledWith(
        expect.stringContaining('provenance_governance_product_schema_org_'),
        expect.stringContaining('package provenance.governance.product_schema'),
      );
    });

    it('sets rego_bundle_ref on the saved version entity', async () => {
      await service.publishPolicyVersion('org-1', dto, 'principal-1');
      // Second save call sets rego_bundle_ref
      expect(policyVersionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          regoBundleRef: expect.stringContaining('provenance_governance_product_schema_org_'),
        }),
      );
    });

    it('upserts the effective policy for the org+domain', async () => {
      await service.publishPolicyVersion('org-1', dto, 'principal-1');
      expect(effectivePolicyRepo.save).toHaveBeenCalled();
    });

    it('updates an existing effective policy rather than creating a new one', async () => {
      const existing = {
        id: 'ep-1',
        orgId: 'org-1',
        policyDomain: 'product_schema',
        scopeType: 'global_floor',
        scopeId: null,
        policyVersionId: 'pv-old',
        computedRules: {},
        computedAt: now,
        updatedAt: now,
      };
      effectivePolicyRepo.findOne.mockResolvedValue(existing);
      effectivePolicyRepo.save.mockResolvedValue(existing);

      await service.publishPolicyVersion('org-1', dto, 'principal-1');

      expect(effectivePolicyRepo.create).not.toHaveBeenCalled();
      expect(effectivePolicyRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ policyVersionId: 'pv-new' }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // revokeException()
  // ---------------------------------------------------------------------------

  describe('revokeException()', () => {
    it('sets revokedAt and revokedBy on the exception', async () => {
      const entity: ExceptionEntity = {
        id: 'ex-1',
        orgId: 'org-1',
        productId: 'product-1',
        policyDomain: 'product_schema',
        policyVersionId: null,
        exceptionReason: 'migration in progress',
        grantedBy: 'principal-1',
        grantedAt: now,
        expiresAt: new Date('2025-01-01'),
        revokedAt: null,
        revokedBy: null,
        updatedAt: now,
      };
      exceptionRepo.findOne.mockResolvedValue(entity);
      exceptionRepo.save.mockImplementation((e: any) => Promise.resolve(e));

      const result = await service.revokeException('org-1', 'ex-1', 'revoker-1');

      expect(exceptionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          revokedBy: 'revoker-1',
          revokedAt: expect.any(Date),
        }),
      );
      expect(result.revokedBy).toBe('revoker-1');
    });

    it('is idempotent — returns the exception unchanged if already revoked', async () => {
      const entity: ExceptionEntity = {
        id: 'ex-1',
        orgId: 'org-1',
        productId: 'product-1',
        policyDomain: 'product_schema',
        policyVersionId: null,
        exceptionReason: 'test',
        grantedBy: 'principal-1',
        grantedAt: now,
        expiresAt: new Date('2025-01-01'),
        revokedAt: now, // already revoked
        revokedBy: 'original-revoker',
        updatedAt: now,
      };
      exceptionRepo.findOne.mockResolvedValue(entity);

      const result = await service.revokeException('org-1', 'ex-1', 'another-revoker');

      expect(exceptionRepo.save).not.toHaveBeenCalled();
      expect(result.revokedBy).toBe('original-revoker');
    });

    it('throws NotFoundException when the exception does not exist', async () => {
      exceptionRepo.findOne.mockResolvedValue(null);

      await expect(service.revokeException('org-1', 'ex-missing', 'principal-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // getComplianceStateByProduct()
  // ---------------------------------------------------------------------------

  describe('getComplianceStateByProduct()', () => {
    it('returns the compliance state for a product', async () => {
      complianceStateRepo.findOne.mockResolvedValue(makeComplianceStateEntity('compliant'));

      const result = await service.getComplianceStateByProduct('org-1', 'product-1');
      expect(result.state).toBe('compliant');
      expect(result.productId).toBe('product-1');
    });

    it('throws NotFoundException when no compliance state exists', async () => {
      complianceStateRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getComplianceStateByProduct('org-1', 'unknown-product'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
