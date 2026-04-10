import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, MoreThanOrEqual } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TrustScoreHistoryEntity } from './entities/trust-score-history.entity.js';
import { ComplianceStateEntity } from '../governance/entities/compliance-state.entity.js';
import { ExceptionEntity } from '../governance/entities/exception.entity.js';
import { AccessGrantEntity } from '../access/entities/access-grant.entity.js';
import { SloService } from '../observability/slo.service.js';
import { LineageService } from '../lineage/lineage.service.js';

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
    private readonly sloService: SloService,
    private readonly lineageService: LineageService,
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

    return {
      product_id: productId,
      org_id: orgId,
      score,
      band,
      components,
      computed_at: saved.computedAt.toISOString(),
    };
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
    const productIds = await this.historyRepo
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
      ) as Array<{ product_id: string; org_id: string }>;

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
}
