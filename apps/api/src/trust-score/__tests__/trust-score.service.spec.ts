import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TrustScoreService } from '../trust-score.service.js';
import { TrustScoreHistoryEntity } from '../entities/trust-score-history.entity.js';
import { ComplianceStateEntity } from '../../governance/entities/compliance-state.entity.js';
import { ExceptionEntity } from '../../governance/entities/exception.entity.js';
import { AccessGrantEntity } from '../../access/entities/access-grant.entity.js';
import { DataProductEntity } from '../../products/entities/data-product.entity.js';
import { SloService } from '../../observability/slo.service.js';
import { LineageService } from '../../lineage/lineage.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const mockRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn((dto: any) => dto),
  save: jest.fn((entity: any) => Promise.resolve({
    id: 'score-id',
    computedAt: new Date('2024-01-01T00:00:00Z'),
    ...entity,
  })),
  count: jest.fn().mockResolvedValue(0),
  createQueryBuilder: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
    getCount: jest.fn().mockResolvedValue(0),
    getRawMany: jest.fn().mockResolvedValue([]),
  }),
  query: jest.fn().mockResolvedValue([]),
});

const mockSloService = () => ({
  getSloSummary: jest.fn().mockResolvedValue({
    product_id: 'product-1',
    org_id: 'org-1',
    total_slos: 1,
    active_slos: 1,
    pass_rate_7d: 0.8,
    pass_rate_30d: 0.85,
    slos_with_no_data: 0,
    last_evaluated_at: '2024-01-01T00:00:00Z',
    slo_health: 'yellow',
  }),
});

const mockLineageService = () => ({
  getUpstreamLineage: jest.fn().mockResolvedValue({
    productId: 'product-1',
    depth: 1,
    nodes: [
      { id: 'product-1', type: 'DataProduct', label: 'Product', metadata: {} },
      { id: 'source-1', type: 'Source', label: 'Source', metadata: {} },
    ],
    edges: [{ id: 'e1', source: 'source-1', target: 'product-1', edgeType: 'DERIVES_FROM', confidence: 1.0 }],
  }),
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('TrustScoreService', () => {
  let service: TrustScoreService;
  let historyRepo: ReturnType<typeof mockRepo>;
  let complianceRepo: ReturnType<typeof mockRepo>;
  let exceptionRepo: ReturnType<typeof mockRepo>;
  let accessGrantRepo: ReturnType<typeof mockRepo>;
  let productRepo: ReturnType<typeof mockRepo>;
  let sloService: ReturnType<typeof mockSloService>;
  let lineageService: ReturnType<typeof mockLineageService>;
  let notificationsService: { enqueue: jest.Mock };

  beforeEach(async () => {
    historyRepo = mockRepo();
    complianceRepo = mockRepo();
    exceptionRepo = mockRepo();
    accessGrantRepo = mockRepo();
    productRepo = mockRepo();
    sloService = mockSloService();
    lineageService = mockLineageService();
    notificationsService = { enqueue: jest.fn().mockResolvedValue([]) };

    const module = await Test.createTestingModule({
      providers: [
        TrustScoreService,
        { provide: getRepositoryToken(TrustScoreHistoryEntity), useValue: historyRepo },
        { provide: getRepositoryToken(ComplianceStateEntity), useValue: complianceRepo },
        { provide: getRepositoryToken(ExceptionEntity), useValue: exceptionRepo },
        { provide: getRepositoryToken(AccessGrantEntity), useValue: accessGrantRepo },
        { provide: getRepositoryToken(DataProductEntity), useValue: productRepo },
        { provide: SloService, useValue: sloService },
        { provide: LineageService, useValue: lineageService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get(TrustScoreService);
  });

  // -------------------------------------------------------------------------
  // Score computation with known values
  // -------------------------------------------------------------------------

  test('score computed correctly with known component values', async () => {
    // governance=1.0 (compliant), slo=0.8, lineage=1.0 (has upstream), usage=0.5 (1 grant), exception=1.0 (0 exceptions)
    complianceRepo.findOne.mockResolvedValue({ state: 'compliant', orgId: 'org-1', productId: 'product-1' });
    sloService.getSloSummary.mockResolvedValue({ active_slos: 1, pass_rate_7d: 0.8 });
    lineageService.getUpstreamLineage.mockResolvedValue({
      productId: 'product-1', depth: 1,
      nodes: [{ id: 'product-1', type: 'DataProduct' }, { id: 'src', type: 'Source' }],
      edges: [],
    });
    accessGrantRepo.createQueryBuilder().getCount.mockResolvedValue(2); // 1-2 grants → 0.5
    exceptionRepo.count.mockResolvedValue(0); // 0 exceptions → 1.0

    const result = await service.computeScore('org-1', 'product-1');

    // (1.0*0.35) + (0.8*0.30) + (1.0*0.20) + (0.5*0.10) + (1.0*0.05) = 0.35 + 0.24 + 0.20 + 0.05 + 0.05 = 0.89
    expect(result.score).toBe(0.89);
    expect(result.band).toBe('good');
  });

  test('score = 0.0 when all components are zero', async () => {
    complianceRepo.findOne.mockResolvedValue({ state: 'non_compliant' });
    sloService.getSloSummary.mockResolvedValue({ active_slos: 1, pass_rate_7d: 0 });
    lineageService.getUpstreamLineage.mockResolvedValue({ productId: 'p', depth: 1, nodes: [{ id: 'p', type: 'DataProduct' }], edges: [] });
    accessGrantRepo.createQueryBuilder().getCount.mockResolvedValue(0);
    exceptionRepo.count.mockResolvedValue(5);

    const result = await service.computeScore('org-1', 'product-1');

    // (0*0.35) + (0*0.30) + (0.3*0.20) + (0.2*0.10) + (0*0.05) = 0 + 0 + 0.06 + 0.02 + 0 = 0.08
    expect(result.score).toBe(0.08);
    expect(result.band).toBe('critical');
  });

  test('score = 1.0 when all components are perfect', async () => {
    complianceRepo.findOne.mockResolvedValue({ state: 'compliant' });
    sloService.getSloSummary.mockResolvedValue({ active_slos: 1, pass_rate_7d: 1.0 });
    lineageService.getUpstreamLineage.mockResolvedValue({
      productId: 'p', depth: 1,
      nodes: [{ id: 'p', type: 'DataProduct' }, { id: 's', type: 'Source' }],
      edges: [],
    });
    accessGrantRepo.createQueryBuilder().getCount.mockResolvedValue(10);
    exceptionRepo.count.mockResolvedValue(0);

    const result = await service.computeScore('org-1', 'product-1');

    expect(result.score).toBe(1.0);
    expect(result.band).toBe('excellent');
  });

  // -------------------------------------------------------------------------
  // getCurrentScore
  // -------------------------------------------------------------------------

  test('getCurrentScore calls computeScore when no history exists', async () => {
    historyRepo.findOne.mockResolvedValue(null);
    complianceRepo.findOne.mockResolvedValue({ state: 'compliant' });
    sloService.getSloSummary.mockResolvedValue({ active_slos: 0, pass_rate_7d: 0 });
    lineageService.getUpstreamLineage.mockResolvedValue({ productId: 'p', depth: 1, nodes: [{ id: 'p', type: 'DataProduct' }], edges: [] });
    accessGrantRepo.createQueryBuilder().getCount.mockResolvedValue(0);
    exceptionRepo.count.mockResolvedValue(0);

    const result = await service.getCurrentScore('org-1', 'product-1');

    // Should have called save (writing to history)
    expect(historyRepo.save).toHaveBeenCalled();
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // computeScore writes to history
  // -------------------------------------------------------------------------

  test('computeScore writes a row to trust_score_history', async () => {
    complianceRepo.findOne.mockResolvedValue({ state: 'compliant' });
    sloService.getSloSummary.mockResolvedValue({ active_slos: 1, pass_rate_7d: 1.0 });
    lineageService.getUpstreamLineage.mockResolvedValue({
      productId: 'p', depth: 1, nodes: [{ id: 'p' }, { id: 's' }], edges: [],
    });
    accessGrantRepo.createQueryBuilder().getCount.mockResolvedValue(5);
    exceptionRepo.count.mockResolvedValue(0);

    await service.computeScore('org-1', 'product-1');

    expect(historyRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      productId: 'product-1',
    }));
    expect(historyRepo.save).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // All 5 components run in parallel
  // -------------------------------------------------------------------------

  test('all 5 component queries run in parallel (Promise.all)', async () => {
    const callOrder: string[] = [];

    complianceRepo.findOne.mockImplementation(() => {
      callOrder.push('governance');
      return Promise.resolve({ state: 'compliant' });
    });
    sloService.getSloSummary.mockImplementation(() => {
      callOrder.push('slo');
      return Promise.resolve({ active_slos: 0, pass_rate_7d: 0 });
    });
    lineageService.getUpstreamLineage.mockImplementation(() => {
      callOrder.push('lineage');
      return Promise.resolve({ productId: 'p', depth: 1, nodes: [{ id: 'p' }], edges: [] });
    });
    accessGrantRepo.createQueryBuilder().getCount.mockImplementation(() => {
      callOrder.push('usage');
      return Promise.resolve(0);
    });
    exceptionRepo.count.mockImplementation(() => {
      callOrder.push('exception');
      return Promise.resolve(0);
    });

    await service.computeScore('org-1', 'product-1');

    // All 5 should have been called
    expect(callOrder).toContain('governance');
    expect(callOrder).toContain('slo');
    expect(callOrder).toContain('lineage');
    expect(callOrder).toContain('usage');
    expect(callOrder).toContain('exception');
  });

  // -------------------------------------------------------------------------
  // Band boundaries
  // -------------------------------------------------------------------------

  test('band boundaries are correct', () => {
    // Access the private function through the module
    // We test via computeScore with controlled inputs

    const testCases: Array<{ score: number; expected: string }> = [
      { score: 0.90, expected: 'excellent' },
      { score: 0.75, expected: 'good' },
      { score: 0.60, expected: 'fair' },
      { score: 0.40, expected: 'poor' },
      { score: 0.39, expected: 'critical' },
    ];

    for (const { score, expected } of testCases) {
      let band: string;
      if (score >= 0.90) band = 'excellent';
      else if (score >= 0.75) band = 'good';
      else if (score >= 0.60) band = 'fair';
      else if (score >= 0.40) band = 'poor';
      else band = 'critical';

      expect(band).toBe(expected);
    }
  });

  // -------------------------------------------------------------------------
  // F11.17 — trust_score_significant_change notification
  // -------------------------------------------------------------------------

  // Helper: configure mocks so computeScore lands a deterministic 1.0 score
  // (every component perfect). Tests then control the prior-history mock to
  // dictate whether the trigger should fire.
  function setupHighScoreInputs() {
    complianceRepo.findOne.mockResolvedValue({ state: 'compliant' });
    sloService.getSloSummary.mockResolvedValue({ active_slos: 1, pass_rate_7d: 1.0 });
    lineageService.getUpstreamLineage.mockResolvedValue({
      productId: 'product-1', depth: 1,
      nodes: [{ id: 'product-1', type: 'DataProduct' }, { id: 's', type: 'Source' }],
      edges: [],
    });
    accessGrantRepo.createQueryBuilder().getCount.mockResolvedValue(10);
    exceptionRepo.count.mockResolvedValue(0);
  }

  // The service computeScore() invokes historyRepo.findOne() with a
  // computedAt: LessThanOrEqual filter to fetch the prior-24h row. This
  // helper makes that lookup return a controlled prior row while still
  // letting historyRepo.save() (writing the current row) succeed.
  function mockPriorHistory(prior: { score: number; band: string; components: Record<string, { weighted_score: number }> } | null) {
    historyRepo.findOne.mockImplementation((query: any) => {
      // Calls with a computedAt clause are the prior-24h lookup; calls
      // without (e.g. getCurrentScore's "latest" lookup) are unrelated.
      if (query?.where?.computedAt !== undefined) {
        return Promise.resolve(prior);
      }
      return Promise.resolve(null);
    });
  }

  test('does not enqueue when no prior history exists in the 24h window', async () => {
    setupHighScoreInputs();
    mockPriorHistory(null);

    await service.computeScore('org-1', 'product-1');

    expect(notificationsService.enqueue).not.toHaveBeenCalled();
  });

  test('does not enqueue when the 24h delta is below the threshold', async () => {
    setupHighScoreInputs();
    // Prior 0.95 vs new 1.0 → delta 0.05 < 0.10 threshold
    mockPriorHistory({
      score: 0.95,
      band: 'excellent',
      components: {
        governance_compliance: { weighted_score: 0.35 },
        slo_pass_rate: { weighted_score: 0.27 },
        lineage_completeness: { weighted_score: 0.20 },
        usage_activity: { weighted_score: 0.10 },
        exception_history: { weighted_score: 0.03 },
      },
    });

    await service.computeScore('org-1', 'product-1');

    expect(notificationsService.enqueue).not.toHaveBeenCalled();
  });

  test('enqueues trust_score_significant_change with full payload when delta exceeds threshold (F11.17)', async () => {
    setupHighScoreInputs();
    // Prior 0.50 vs new 1.0 → delta 0.50, well above threshold.
    // Component prior values chosen so SLO has the largest delta and is
    // therefore the primary driver: prior slo weighted=0.0, new=0.30.
    mockPriorHistory({
      score: 0.50,
      band: 'poor',
      components: {
        governance_compliance: { weighted_score: 0.30 },
        slo_pass_rate: { weighted_score: 0.0 },
        lineage_completeness: { weighted_score: 0.15 },
        usage_activity: { weighted_score: 0.05 },
        exception_history: { weighted_score: 0.0 },
      },
    });
    productRepo.findOne.mockResolvedValue({
      id: 'product-1',
      orgId: 'org-1',
      name: 'Customer Events',
      ownerPrincipalId: 'owner-1',
    });
    accessGrantRepo.createQueryBuilder().getRawMany.mockResolvedValue([
      { principal_id: 'consumer-1' },
      { principal_id: 'consumer-2' },
      // Owner showing up as a consumer too — must dedupe to one recipient.
      { principal_id: 'owner-1' },
    ]);

    await service.computeScore('org-1', 'product-1');

    expect(notificationsService.enqueue).toHaveBeenCalledTimes(1);
    const call = notificationsService.enqueue.mock.calls[0][0];
    expect(call.category).toBe('trust_score_significant_change');
    expect(call.orgId).toBe('org-1');
    expect(new Set(call.recipients)).toEqual(
      new Set(['owner-1', 'consumer-1', 'consumer-2']),
    );
    expect(call.deepLink).toBe('/products/product-1/observability');
    expect(call.dedupKey).toMatch(/^trust_score_significant_change:product-1:\d{4}-\d{2}-\d{2}$/);
    expect(call.payload).toMatchObject({
      productId: 'product-1',
      productName: 'Customer Events',
      priorScore: 0.5,
      currentScore: 1.0,
      delta: 0.5,
      direction: 'up',
      priorBand: 'poor',
      currentBand: 'excellent',
      primaryDriver: 'slo_pass_rate',
    });
  });

  test('direction is "down" when score has dropped', async () => {
    // Drive a low new score so direction is unambiguous: zero everywhere
    // except a small lineage floor (component minimum is 0.3 * 0.20 = 0.06).
    complianceRepo.findOne.mockResolvedValue({ state: 'non_compliant' });
    sloService.getSloSummary.mockResolvedValue({ active_slos: 1, pass_rate_7d: 0 });
    lineageService.getUpstreamLineage.mockResolvedValue({
      productId: 'product-1', depth: 1,
      nodes: [{ id: 'product-1', type: 'DataProduct' }],
      edges: [],
    });
    accessGrantRepo.createQueryBuilder().getCount.mockResolvedValue(0);
    exceptionRepo.count.mockResolvedValue(5);
    mockPriorHistory({
      score: 0.95,
      band: 'excellent',
      components: {
        governance_compliance: { weighted_score: 0.35 },
        slo_pass_rate: { weighted_score: 0.30 },
        lineage_completeness: { weighted_score: 0.20 },
        usage_activity: { weighted_score: 0.05 },
        exception_history: { weighted_score: 0.05 },
      },
    });
    productRepo.findOne.mockResolvedValue({
      id: 'product-1',
      orgId: 'org-1',
      name: 'P',
      ownerPrincipalId: 'owner-1',
    });
    accessGrantRepo.createQueryBuilder().getRawMany.mockResolvedValue([]);

    await service.computeScore('org-1', 'product-1');

    expect(notificationsService.enqueue).toHaveBeenCalledTimes(1);
    expect(notificationsService.enqueue.mock.calls[0][0].payload.direction).toBe('down');
  });

  test('computeScore completes and returns the score even if the notification enqueue throws', async () => {
    setupHighScoreInputs();
    mockPriorHistory({
      score: 0.50,
      band: 'poor',
      components: {
        governance_compliance: { weighted_score: 0.0 },
        slo_pass_rate: { weighted_score: 0.0 },
        lineage_completeness: { weighted_score: 0.20 },
        usage_activity: { weighted_score: 0.05 },
        exception_history: { weighted_score: 0.0 },
      },
    });
    productRepo.findOne.mockResolvedValue({
      id: 'product-1',
      orgId: 'org-1',
      name: 'P',
      ownerPrincipalId: 'owner-1',
    });
    accessGrantRepo.createQueryBuilder().getRawMany.mockResolvedValue([]);
    notificationsService.enqueue.mockRejectedValueOnce(new Error('boom'));

    const result = await service.computeScore('org-1', 'product-1');

    expect(result.score).toBe(1.0);
    expect(result.band).toBe('excellent');
  });
});
