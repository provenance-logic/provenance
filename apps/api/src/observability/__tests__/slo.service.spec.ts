import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SloService } from '../slo.service.js';
import { SloDeclarationEntity } from '../entities/slo-declaration.entity.js';
import { SloEvaluationEntity } from '../entities/slo-evaluation.entity.js';
import { DataProductEntity } from '../../products/entities/data-product.entity.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const mockRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn((dto: Record<string, unknown>) => dto),
  save: jest.fn((entity: Record<string, unknown>) => Promise.resolve({
    id: 'generated-id',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...entity,
  })),
});

const ORG_ID = 'org-1';
const PRODUCT_ID = 'product-1';
const SLO_ID = 'slo-1';

// Generates evaluation entities with passed/failed distribution
function makeEvals(count: number, passed: number, daysAgo: number = 3): Partial<SloEvaluationEntity>[] {
  const evals: Partial<SloEvaluationEntity>[] = [];
  const base = new Date();
  base.setDate(base.getDate() - daysAgo);
  for (let i = 0; i < count; i++) {
    evals.push({
      id: `eval-${i}`,
      sloId: SLO_ID,
      orgId: ORG_ID,
      measuredValue: i < passed ? 10 : 100,
      passed: i < passed,
      evaluatedAt: new Date(base.getTime() + i * 1000),
      evaluatedBy: 'test-runner',
      details: null,
      createdAt: new Date(base.getTime() + i * 1000),
    });
  }
  return evals;
}

function makeDecl(overrides: Partial<SloDeclarationEntity> = {}): Partial<SloDeclarationEntity> {
  return {
    id: SLO_ID,
    orgId: ORG_ID,
    productId: PRODUCT_ID,
    name: 'Freshness SLO',
    description: null,
    sloType: 'freshness',
    metricName: 'hours_since_refresh',
    thresholdOperator: 'lte',
    thresholdValue: 24,
    thresholdUnit: 'hours',
    evaluationWindowHours: 24,
    externalSystem: null,
    active: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('SloService', () => {
  let service: SloService;
  let declRepo: ReturnType<typeof mockRepo>;
  let evalRepo: ReturnType<typeof mockRepo>;
  let productRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    declRepo = mockRepo();
    evalRepo = mockRepo();
    productRepo = mockRepo();

    const module = await Test.createTestingModule({
      providers: [
        SloService,
        { provide: getRepositoryToken(SloDeclarationEntity), useValue: declRepo },
        { provide: getRepositoryToken(SloEvaluationEntity), useValue: evalRepo },
        { provide: getRepositoryToken(DataProductEntity), useValue: productRepo },
      ],
    }).compile();

    service = module.get(SloService);
  });

  // -------------------------------------------------------------------------
  // createDeclaration
  // -------------------------------------------------------------------------

  test('createDeclaration rejects if product does not belong to org', async () => {
    productRepo.findOne.mockResolvedValue(null);

    await expect(
      service.createDeclaration(ORG_ID, PRODUCT_ID, {
        name: 'Test SLO',
        slo_type: 'freshness',
        metric_name: 'hours',
        threshold_operator: 'lte',
        threshold_value: 24,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  // -------------------------------------------------------------------------
  // listDeclarations
  // -------------------------------------------------------------------------

  test('listDeclarations returns pass_rate_7d computed correctly', async () => {
    declRepo.find.mockResolvedValue([makeDecl()]);
    // 8 evaluations, 6 passed → 0.75
    const evals = makeEvals(8, 6);
    evalRepo.find.mockResolvedValue(evals);
    evalRepo.findOne.mockResolvedValue(evals[0]);

    const result = await service.listDeclarations(ORG_ID, PRODUCT_ID, 'active');

    expect(result.items).toHaveLength(1);
    expect(result.items[0].pass_rate_7d).toBe(0.75);
  });

  // -------------------------------------------------------------------------
  // getSloSummary
  // -------------------------------------------------------------------------

  test('getSloSummary returns green when pass_rate_7d >= 0.95', async () => {
    declRepo.find.mockResolvedValue([makeDecl()]);
    // 20 evals, 19 passed → 0.95
    evalRepo.find.mockImplementation(({ where }: any) => {
      return Promise.resolve(makeEvals(20, 19));
    });

    const summary = await service.getSloSummary(ORG_ID, PRODUCT_ID);

    expect(summary.slo_health).toBe('green');
    expect(summary.pass_rate_7d).toBe(0.95);
  });

  test('getSloSummary returns yellow when pass_rate_7d >= 0.80', async () => {
    declRepo.find.mockResolvedValue([makeDecl()]);
    // 10 evals, 9 passed → 0.9
    evalRepo.find.mockResolvedValue(makeEvals(10, 9));

    const summary = await service.getSloSummary(ORG_ID, PRODUCT_ID);

    expect(summary.slo_health).toBe('yellow');
    expect(summary.pass_rate_7d).toBe(0.9);
  });

  test('getSloSummary returns red when pass_rate_7d < 0.80', async () => {
    declRepo.find.mockResolvedValue([makeDecl()]);
    // 10 evals, 7 passed → 0.7
    evalRepo.find.mockResolvedValue(makeEvals(10, 7));

    const summary = await service.getSloSummary(ORG_ID, PRODUCT_ID);

    expect(summary.slo_health).toBe('red');
    expect(summary.pass_rate_7d).toBe(0.7);
  });

  test('getSloSummary returns red when all active SLOs have no data', async () => {
    declRepo.find.mockResolvedValue([makeDecl()]);
    evalRepo.find.mockResolvedValue([]); // no evaluations

    const summary = await service.getSloSummary(ORG_ID, PRODUCT_ID);

    expect(summary.slo_health).toBe('red');
    expect(summary.slos_with_no_data).toBe(1);
    expect(summary.active_slos).toBe(1);
  });

  // -------------------------------------------------------------------------
  // createEvaluation
  // -------------------------------------------------------------------------

  test('createEvaluation rejects if slo does not belong to org', async () => {
    declRepo.findOne.mockResolvedValue(null);

    await expect(
      service.createEvaluation(ORG_ID, SLO_ID, {
        measured_value: 18.5,
        passed: true,
        evaluated_at: new Date().toISOString(),
        evaluated_by: 'test',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  // -------------------------------------------------------------------------
  // deleteDeclaration
  // -------------------------------------------------------------------------

  test('deleteDeclaration sets active = false, does not delete the row', async () => {
    const decl = makeDecl({ active: true });
    declRepo.findOne.mockResolvedValue(decl);
    declRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));

    await service.deleteDeclaration(ORG_ID, SLO_ID);

    expect(declRepo.save).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
    // Verify no hard-delete method was called
    expect(declRepo).not.toHaveProperty('delete');
  });
});
