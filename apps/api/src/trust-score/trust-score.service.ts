import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TrustScoreHistoryEntity } from './entities/trust-score-history.entity.js';
import { ComplianceStateEntity } from '../governance/entities/compliance-state.entity.js';
import { ExceptionEntity } from '../governance/entities/exception.entity.js';
import { AccessGrantEntity } from '../access/entities/access-grant.entity.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { SloService } from '../observability/slo.service.js';
import { LineageService } from '../lineage/lineage.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

// ---------------------------------------------------------------------------
// DTO types
// ---------------------------------------------------------------------------

export interface TrustScoreComponentDto {
  raw_value: number | string;
  component_score: number;
  weight: number;
  weighted_score: number;
}

export interface TrustScoreComponentsDto {
  governance_compliance: TrustScoreComponentDto;
  slo_pass_rate: TrustScoreComponentDto;
  lineage_completeness: TrustScoreComponentDto;
  usage_activity: TrustScoreComponentDto;
  exception_history: TrustScoreComponentDto;
}

export interface TrustScoreDto {
  product_id: string;
  org_id: string;
  score: number;
  band: string;
  components: TrustScoreComponentsDto;
  computed_at: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEIGHTS = {
  governance: 0.35,
  slo: 0.30,
  lineage: 0.20,
  usage: 0.10,
  exception: 0.05,
} as const;

// F11.17 — Threshold beyond which a 24-hour change in trust score is treated
// as significant and a notification is fanned out to the product owner and
// active consumers. Score is on the [0.0, 1.0] scale; 0.10 corresponds to the
// PRD-default "10 points" on a 0–100 representation.
const TRUST_SCORE_CHANGE_THRESHOLD = 0.10;

// Component identifiers used to attribute the primary driver of a significant
// trust-score change. Order is irrelevant — selection is purely on max delta.
const COMPONENT_KEYS = [
  'governance_compliance',
  'slo_pass_rate',
  'lineage_completeness',
  'usage_activity',
  'exception_history',
] as const;
type ComponentKey = (typeof COMPONENT_KEYS)[number];

function scoreToBand(score: number): string {
  if (score >= 0.90) return 'excellent';
  if (score >= 0.75) return 'good';
  if (score >= 0.60) return 'fair';
  if (score >= 0.40) return 'poor';
  return 'critical';
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class TrustScoreService {
  private readonly logger = new Logger(TrustScoreService.name);

  constructor(
    @InjectRepository(TrustScoreHistoryEntity)
    private readonly historyRepo: Repository<TrustScoreHistoryEntity>,
    @InjectRepository(ComplianceStateEntity)
    private readonly complianceRepo: Repository<ComplianceStateEntity>,
    @InjectRepository(ExceptionEntity)
    private readonly exceptionRepo: Repository<ExceptionEntity>,
    @InjectRepository(AccessGrantEntity)
    private readonly accessGrantRepo: Repository<AccessGrantEntity>,
    @InjectRepository(DataProductEntity)
    private readonly productRepo: Repository<DataProductEntity>,
    private readonly sloService: SloService,
    private readonly lineageService: LineageService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async computeScore(orgId: string, productId: string): Promise<TrustScoreDto> {
    const [governance, slo, lineage, usage, exception] = await Promise.all([
      this._getGovernanceComponent(orgId, productId),
      this._getSloComponent(orgId, productId),
      this._getLineageComponent(orgId, productId),
      this._getUsageComponent(orgId, productId),
      this._getExceptionComponent(orgId, productId),
    ]);

    const score = Math.round(
      (governance.weighted_score +
        slo.weighted_score +
        lineage.weighted_score +
        usage.weighted_score +
        exception.weighted_score) * 10000,
    ) / 10000;

    const band = scoreToBand(score);
    const components: TrustScoreComponentsDto = {
      governance_compliance: governance,
      slo_pass_rate: slo,
      lineage_completeness: lineage,
      usage_activity: usage,
      exception_history: exception,
    };

    // Persist to history
    const entity = this.historyRepo.create({
      orgId,
      productId,
      score,
      band,
      components: components as unknown as Record<string, unknown>,
    });
    const saved = await this.historyRepo.save(entity);

    const result: TrustScoreDto = {
      product_id: productId,
      org_id: orgId,
      score,
      band,
      components,
      computed_at: saved.computedAt.toISOString(),
    };

    // F11.17 — fire trust_score_significant_change when the score has moved
    // by at least TRUST_SCORE_CHANGE_THRESHOLD compared to the score from
    // 24h ago. Best-effort; never roll back the history insert if the
    // notification enqueue fails.
    await this._maybeEmitSignificantChangeNotification(orgId, productId, result);

    return result;
  }

  async getCurrentScore(orgId: string, productId: string): Promise<TrustScoreDto> {
    const latest = await this.historyRepo.findOne({
      where: { orgId, productId },
      order: { computedAt: 'DESC' },
    });

    if (!latest) {
      return this.computeScore(orgId, productId);
    }

    return {
      product_id: latest.productId,
      org_id: latest.orgId,
      score: Number(latest.score),
      band: latest.band,
      components: latest.components as unknown as TrustScoreComponentsDto,
      computed_at: latest.computedAt.toISOString(),
    };
  }

  async getHistory(
    orgId: string,
    productId: string,
    limit: number = 30,
    from?: string,
    to?: string,
  ) {
    const qb = this.historyRepo
      .createQueryBuilder('h')
      .where('h.org_id = :orgId AND h.product_id = :productId', { orgId, productId })
      .orderBy('h.computed_at', 'DESC')
      .take(Math.min(limit, 90));

    if (from) qb.andWhere('h.computed_at >= :from', { from });
    if (to) qb.andWhere('h.computed_at <= :to', { to });

    const rows = await qb.getMany();
    return rows.map((r) => ({
      id: r.id,
      product_id: r.productId,
      score: Number(r.score),
      band: r.band,
      components: r.components,
      computed_at: r.computedAt.toISOString(),
    }));
  }

  async recompute(orgId: string, productId: string): Promise<TrustScoreDto> {
    return this.computeScore(orgId, productId);
  }

  // ---------------------------------------------------------------------------
  // Component methods
  // ---------------------------------------------------------------------------

  async _getGovernanceComponent(orgId: string, productId: string): Promise<TrustScoreComponentDto> {
    const compliance = await this.complianceRepo.findOne({
      where: { orgId, productId },
    });

    let componentScore: number;
    let rawValue: string;

    if (!compliance) {
      rawValue = 'no_policy';
      componentScore = 0.8;
    } else {
      rawValue = compliance.state;
      switch (compliance.state) {
        case 'compliant':
          componentScore = 1.0;
          break;
        case 'drift_detected':
          componentScore = 0.7;
          break;
        case 'grace_period':
          componentScore = 0.5;
          break;
        default:
          componentScore = 0.0;
      }
    }

    return {
      raw_value: rawValue,
      component_score: componentScore,
      weight: WEIGHTS.governance,
      weighted_score: Math.round(componentScore * WEIGHTS.governance * 10000) / 10000,
    };
  }

  async _getSloComponent(orgId: string, productId: string): Promise<TrustScoreComponentDto> {
    try {
      const summary = await this.sloService.getSloSummary(orgId, productId);
      const rawValue = summary.active_slos === 0 ? 0.5 : summary.pass_rate_7d;
      return {
        raw_value: rawValue,
        component_score: rawValue,
        weight: WEIGHTS.slo,
        weighted_score: Math.round(rawValue * WEIGHTS.slo * 10000) / 10000,
      };
    } catch {
      return {
        raw_value: 0.5,
        component_score: 0.5,
        weight: WEIGHTS.slo,
        weighted_score: Math.round(0.5 * WEIGHTS.slo * 10000) / 10000,
      };
    }
  }

  async _getLineageComponent(orgId: string, productId: string): Promise<TrustScoreComponentDto> {
    try {
      const graph = await this.lineageService.getUpstreamLineage(orgId, productId, 1);
      const upstreamCount = graph.nodes.length > 1 ? graph.nodes.length - 1 : 0;

      // Check if this product is a source node in the graph
      const selfNode = graph.nodes.find((n) => n.id === productId);
      const isSource = selfNode?.type === 'Source';

      let componentScore: number;
      if (isSource) {
        componentScore = 1.0;
      } else if (upstreamCount > 0) {
        componentScore = 1.0;
      } else {
        componentScore = 0.3;
      }

      return {
        raw_value: upstreamCount,
        component_score: componentScore,
        weight: WEIGHTS.lineage,
        weighted_score: Math.round(componentScore * WEIGHTS.lineage * 10000) / 10000,
      };
    } catch {
      return {
        raw_value: 0,
        component_score: 0.3,
        weight: WEIGHTS.lineage,
        weighted_score: Math.round(0.3 * WEIGHTS.lineage * 10000) / 10000,
      };
    }
  }

  async _getUsageComponent(orgId: string, productId: string): Promise<TrustScoreComponentDto> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const count = await this.accessGrantRepo
      .createQueryBuilder('g')
      .where('g.product_id = :productId', { productId })
      .andWhere('g.org_id = :orgId', { orgId })
      .andWhere('g.revoked_at IS NULL')
      .andWhere('(g.expires_at IS NULL OR g.expires_at > :now)', { now: new Date() })
      .andWhere('g.granted_at >= :since', { since: thirtyDaysAgo })
      .getCount();

    let componentScore: number;
    if (count >= 5) componentScore = 1.0;
    else if (count >= 3) componentScore = 0.8;
    else if (count >= 1) componentScore = 0.5;
    else componentScore = 0.2;

    return {
      raw_value: count,
      component_score: componentScore,
      weight: WEIGHTS.usage,
      weighted_score: Math.round(componentScore * WEIGHTS.usage * 10000) / 10000,
    };
  }

  async _getExceptionComponent(orgId: string, productId: string): Promise<TrustScoreComponentDto> {
    const now = new Date();
    const count = await this.exceptionRepo.count({
      where: {
        orgId,
        productId,
        revokedAt: IsNull(),
        expiresAt: MoreThanOrEqual(now),
      },
    });

    let componentScore: number;
    if (count === 0) componentScore = 1.0;
    else if (count === 1) componentScore = 0.7;
    else if (count === 2) componentScore = 0.4;
    else componentScore = 0.0;

    return {
      raw_value: count,
      component_score: componentScore,
      weight: WEIGHTS.exception,
      weighted_score: Math.round(componentScore * WEIGHTS.exception * 10000) / 10000,
    };
  }

  // ---------------------------------------------------------------------------
  // Cron-based recomputation (dev stack replacement for Temporal)
  // ---------------------------------------------------------------------------

  @Cron(CronExpression.EVERY_5_MINUTES)
  async cronRecompute(): Promise<void> {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    // Find products with recent material events
    const productIds: Array<{ product_id: string; org_id: string }> = await this.historyRepo
      .query(
        `
        SELECT DISTINCT product_id, org_id FROM (
          SELECT product_id, org_id FROM governance.compliance_states WHERE updated_at >= $1
          UNION
          SELECT sd.product_id, sd.org_id FROM observability.slo_evaluations se
            JOIN observability.slo_declarations sd ON se.slo_id = sd.id
            WHERE se.created_at >= $1
          UNION
          SELECT (target_node->>'node_id')::uuid AS product_id, org_id FROM lineage.emission_log WHERE created_at >= $1 AND (target_node->>'node_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          UNION
          SELECT product_id, org_id FROM access.access_grants WHERE granted_at >= $1
          UNION
          SELECT product_id, org_id FROM governance.exceptions WHERE updated_at >= $1
        ) AS changed
        WHERE product_id IS NOT NULL
        `,
        [tenMinutesAgo],
      );

    if (productIds.length > 0) {
      this.logger.log(`Cron recompute: ${productIds.length} products with recent changes`);
    }

    for (const { product_id, org_id } of productIds) {
      try {
        await this.computeScore(org_id, product_id);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Cron recompute failed for ${product_id}: ${msg}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // F11.17 — Trust score significant change notification
  // ---------------------------------------------------------------------------

  private async _maybeEmitSignificantChangeNotification(
    orgId: string,
    productId: string,
    current: TrustScoreDto,
  ): Promise<void> {
    try {
      // Compare against the score that was current 24 hours ago. Using
      // at-or-before now-24h (rather than the immediately preceding row)
      // means gradual drift over a day still trips the threshold — a 5-min
      // cron of small step changes will eventually exceed it once 24h of
      // history accumulates. If no history is at least 24h old, the product
      // hasn't been around long enough to assess a 24-hour change and we
      // stay silent.
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const prior = await this.historyRepo.findOne({
        where: {
          orgId,
          productId,
          computedAt: LessThanOrEqual(twentyFourHoursAgo),
        },
        order: { computedAt: 'DESC' },
      });
      if (!prior) return;

      const priorScore = Number(prior.score);
      const delta = Math.abs(current.score - priorScore);
      if (delta < TRUST_SCORE_CHANGE_THRESHOLD) return;

      const product = await this.productRepo.findOne({
        where: { id: productId, orgId },
      });
      if (!product) return;

      // Recipients = product owner ∪ principals with an active, unexpired
      // access grant. Deduped — owner doubling as a consumer should still
      // only receive one notification.
      const grantRows = await this.accessGrantRepo
        .createQueryBuilder('g')
        .select('DISTINCT g.principal_id', 'principal_id')
        .where('g.product_id = :productId', { productId })
        .andWhere('g.org_id = :orgId', { orgId })
        .andWhere('g.revoked_at IS NULL')
        .andWhere('(g.expires_at IS NULL OR g.expires_at > :now)', { now: new Date() })
        .getRawMany<{ principal_id: string }>();
      const recipients = Array.from(
        new Set<string>([
          product.ownerPrincipalId,
          ...grantRows.map((r) => r.principal_id),
        ]),
      );
      if (recipients.length === 0) return;

      const priorComponents = prior.components as unknown as TrustScoreComponentsDto;
      const primaryDriver = this._computePrimaryDriver(priorComponents, current.components);

      // Daily-bucketed dedup so a sustained shift only emits once per day
      // per recipient. The 15-minute in-memory dedup window in
      // NotificationsService alone would be too short to suppress repeats
      // across a sustained change at the 5-minute recompute cadence.
      const dateBucket = new Date().toISOString().slice(0, 10);

      await this.notificationsService.enqueue({
        orgId,
        category: 'trust_score_significant_change',
        recipients,
        payload: {
          productId,
          productName: product.name,
          priorScore: Math.round(priorScore * 10000) / 10000,
          currentScore: current.score,
          delta: Math.round(delta * 10000) / 10000,
          direction: current.score >= priorScore ? 'up' : 'down',
          priorBand: prior.band,
          currentBand: current.band,
          primaryDriver,
        },
        deepLink: `/products/${productId}/observability`,
        dedupKey: `trust_score_significant_change:${productId}:${dateBucket}`,
      });
    } catch (err) {
      this.logger.error(
        `trust_score_significant_change notification enqueue failed for product ${productId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private _computePrimaryDriver(
    prior: TrustScoreComponentsDto,
    current: TrustScoreComponentsDto,
  ): ComponentKey {
    let maxKey: ComponentKey = COMPONENT_KEYS[0];
    let maxAbs = -1;
    for (const key of COMPONENT_KEYS) {
      const diff = Math.abs(current[key].weighted_score - prior[key].weighted_score);
      if (diff > maxAbs) {
        maxAbs = diff;
        maxKey = key;
      }
    }
    return maxKey;
  }
}
