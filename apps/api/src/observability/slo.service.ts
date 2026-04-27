import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import { SloDeclarationEntity } from './entities/slo-declaration.entity.js';
import { SloEvaluationEntity } from './entities/slo-evaluation.entity.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { TrustScoreService } from '../trust-score/trust-score.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

// ---------------------------------------------------------------------------
// DTO interfaces (used by controller and trust score engine)
// ---------------------------------------------------------------------------

export interface CreateSloDeclarationDto {
  name: string;
  description?: string;
  slo_type: string;
  metric_name: string;
  threshold_operator: string;
  threshold_value: number;
  threshold_unit?: string;
  evaluation_window_hours?: number;
  external_system?: string;
}

export interface UpdateSloDeclarationDto {
  description?: string;
  threshold_value?: number;
  active?: boolean;
}

export interface CreateSloEvaluationDto {
  measured_value: number;
  passed: boolean;
  evaluated_at: string;
  evaluated_by: string;
  details?: Record<string, unknown>;
}

export interface SloSummaryDto {
  product_id: string;
  org_id: string;
  total_slos: number;
  active_slos: number;
  pass_rate_7d: number;
  pass_rate_30d: number;
  slos_with_no_data: number;
  last_evaluated_at: string | null;
  slo_health: 'green' | 'yellow' | 'red';
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class SloService {
  private readonly logger = new Logger(SloService.name);

  constructor(
    @InjectRepository(SloDeclarationEntity)
    private readonly declarationRepo: Repository<SloDeclarationEntity>,
    @InjectRepository(SloEvaluationEntity)
    private readonly evaluationRepo: Repository<SloEvaluationEntity>,
    @InjectRepository(DataProductEntity)
    private readonly productRepo: Repository<DataProductEntity>,
    @Inject(forwardRef(() => TrustScoreService))
    private readonly trustScoreService: TrustScoreService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Declarations
  // ---------------------------------------------------------------------------

  async createDeclaration(orgId: string, productId: string, dto: CreateSloDeclarationDto) {
    const product = await this.productRepo.findOne({ where: { id: productId, orgId } });
    if (!product) throw new BadRequestException(`Product ${productId} not found in org ${orgId}`);

    const entity = this.declarationRepo.create({
      orgId,
      productId,
      name: dto.name,
      description: dto.description ?? null,
      sloType: dto.slo_type,
      metricName: dto.metric_name,
      thresholdOperator: dto.threshold_operator,
      thresholdValue: dto.threshold_value,
      thresholdUnit: dto.threshold_unit ?? null,
      evaluationWindowHours: dto.evaluation_window_hours ?? 24,
      externalSystem: dto.external_system ?? null,
    });

    const saved = await this.declarationRepo.save(entity);
    return this.toDeclarationDto(saved);
  }

  async listDeclarations(orgId: string, productId: string, status: string = 'active') {
    const where: Record<string, unknown> = { orgId, productId };
    if (status === 'active') where['active'] = true;
    else if (status === 'inactive') where['active'] = false;

    const items = await this.declarationRepo.find({ where, order: { createdAt: 'DESC' } });

    const enriched = await Promise.all(items.map(async (d) => {
      const passRates = await this.computePassRates(d.id);
      return { ...this.toDeclarationDto(d), ...passRates };
    }));

    return { items: enriched };
  }

  async getDeclaration(orgId: string, sloId: string) {
    const decl = await this.declarationRepo.findOne({ where: { id: sloId, orgId } });
    if (!decl) throw new NotFoundException(`SLO ${sloId} not found`);

    const evaluations = await this.evaluationRepo.find({
      where: { sloId },
      order: { evaluatedAt: 'DESC' },
      take: 30,
    });

    const passRates = await this.computePassRates(sloId);

    return {
      ...this.toDeclarationDto(decl),
      ...passRates,
      evaluations: evaluations.map((e) => this.toEvaluationDto(e)),
    };
  }

  async updateDeclaration(orgId: string, sloId: string, dto: UpdateSloDeclarationDto) {
    const decl = await this.declarationRepo.findOne({ where: { id: sloId, orgId } });
    if (!decl) throw new NotFoundException(`SLO ${sloId} not found`);

    if (dto.description !== undefined) decl.description = dto.description;
    if (dto.threshold_value !== undefined) decl.thresholdValue = dto.threshold_value;
    if (dto.active !== undefined) decl.active = dto.active;

    const saved = await this.declarationRepo.save(decl);
    return this.toDeclarationDto(saved);
  }

  async deleteDeclaration(orgId: string, sloId: string): Promise<void> {
    const decl = await this.declarationRepo.findOne({ where: { id: sloId, orgId } });
    if (!decl) throw new NotFoundException(`SLO ${sloId} not found`);

    decl.active = false;
    await this.declarationRepo.save(decl);
  }

  // ---------------------------------------------------------------------------
  // Evaluations
  // ---------------------------------------------------------------------------

  async createEvaluation(orgId: string, sloId: string, dto: CreateSloEvaluationDto) {
    const decl = await this.declarationRepo.findOne({ where: { id: sloId, orgId } });
    if (!decl) throw new NotFoundException(`SLO ${sloId} not found in org ${orgId}`);

    const entity = this.evaluationRepo.create({
      sloId,
      orgId,
      measuredValue: dto.measured_value,
      passed: dto.passed,
      evaluatedAt: new Date(dto.evaluated_at),
      evaluatedBy: dto.evaluated_by,
      details: dto.details ?? null,
    });

    const saved = await this.evaluationRepo.save(entity);

    // Fire-and-forget trust score recompute
    this.trustScoreService.recompute(orgId, decl.productId).catch(() => {});

    // F11.16 — fire SLO violation notification when the evaluation failed.
    // Best-effort; never roll back the evaluation insert if notification fails.
    if (!saved.passed) {
      try {
        const product = await this.productRepo.findOne({
          where: { id: decl.productId, orgId },
        });
        if (product) {
          // Dedup key includes evaluation date so multiple breaches in the
          // same calendar day collapse, but a recurrence on the next day
          // still fires (the 15-min in-memory dedup window would otherwise
          // expire too quickly to suppress repeats during a sustained
          // incident).
          const dateBucket = saved.evaluatedAt.toISOString().slice(0, 10);
          await this.notificationsService.enqueue({
            orgId,
            category: 'slo_violation',
            recipients: [product.ownerPrincipalId],
            payload: {
              productId: product.id,
              productName: product.name,
              sloId: decl.id,
              sloName: decl.name,
              sloType: decl.sloType,
              metricName: decl.metricName,
              thresholdValue: Number(decl.thresholdValue),
              thresholdOperator: decl.thresholdOperator,
              measuredValue: Number(saved.measuredValue),
              evaluatedAt: saved.evaluatedAt.toISOString(),
            },
            deepLink: `/products/${product.id}/observability`,
            dedupKey: `slo_violation:${decl.id}:${dateBucket}`,
          });
        }
      } catch (err) {
        this.logger.error(
          `SLO violation notification enqueue failed for SLO ${decl.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return this.toEvaluationDto(saved);
  }

  async listEvaluations(
    orgId: string,
    sloId: string,
    limit: number = 50,
    from?: string,
    to?: string,
  ) {
    const decl = await this.declarationRepo.findOne({ where: { id: sloId, orgId } });
    if (!decl) throw new NotFoundException(`SLO ${sloId} not found`);

    const where: Record<string, unknown> = { sloId };
    if (from) where['evaluatedAt'] = MoreThanOrEqual(new Date(from));
    if (to) where['evaluatedAt'] = LessThanOrEqual(new Date(to));

    const items = await this.evaluationRepo.find({
      where,
      order: { evaluatedAt: 'DESC' },
      take: Math.min(limit, 200),
    });

    return items.map((e) => this.toEvaluationDto(e));
  }

  // ---------------------------------------------------------------------------
  // Summary — PUBLIC METHOD, called by trust score engine
  // ---------------------------------------------------------------------------

  async getSloSummary(orgId: string, productId: string): Promise<SloSummaryDto> {
    const allDecls = await this.declarationRepo.find({
      where: { orgId, productId },
    });

    const activeDecls = allDecls.filter((d) => d.active);
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    let totalPassed7d = 0;
    let totalEvals7d = 0;
    let totalPassed30d = 0;
    let totalEvals30d = 0;
    let slosWithNoData = 0;
    let lastEvaluatedAt: Date | null = null;

    for (const decl of activeDecls) {
      const evals7d = await this.evaluationRepo.find({
        where: { sloId: decl.id, evaluatedAt: MoreThanOrEqual(sevenDaysAgo) },
      });
      const evals30d = await this.evaluationRepo.find({
        where: { sloId: decl.id, evaluatedAt: MoreThanOrEqual(thirtyDaysAgo) },
      });

      if (evals7d.length === 0 && evals30d.length === 0) {
        slosWithNoData++;
        continue;
      }

      totalPassed7d += evals7d.filter((e) => e.passed).length;
      totalEvals7d += evals7d.length;
      totalPassed30d += evals30d.filter((e) => e.passed).length;
      totalEvals30d += evals30d.length;

      const latest = evals30d[0];
      if (latest && (!lastEvaluatedAt || latest.evaluatedAt > lastEvaluatedAt)) {
        lastEvaluatedAt = latest.evaluatedAt;
      }
    }

    const passRate7d = totalEvals7d > 0 ? totalPassed7d / totalEvals7d : 0;
    const passRate30d = totalEvals30d > 0 ? totalPassed30d / totalEvals30d : 0;

    let sloHealth: 'green' | 'yellow' | 'red';
    if (activeDecls.length > 0 && slosWithNoData === activeDecls.length) {
      sloHealth = 'red';
    } else if (passRate7d >= 0.95) {
      sloHealth = 'green';
    } else if (passRate7d >= 0.80) {
      sloHealth = 'yellow';
    } else {
      sloHealth = 'red';
    }

    return {
      product_id: productId,
      org_id: orgId,
      total_slos: allDecls.length,
      active_slos: activeDecls.length,
      pass_rate_7d: Math.round(passRate7d * 10000) / 10000,
      pass_rate_30d: Math.round(passRate30d * 10000) / 10000,
      slos_with_no_data: slosWithNoData,
      last_evaluated_at: lastEvaluatedAt?.toISOString() ?? null,
      slo_health: sloHealth,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async computePassRates(sloId: string) {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const evals7d = await this.evaluationRepo.find({
      where: { sloId, evaluatedAt: MoreThanOrEqual(sevenDaysAgo) },
    });
    const evals30d = await this.evaluationRepo.find({
      where: { sloId, evaluatedAt: MoreThanOrEqual(thirtyDaysAgo) },
    });

    const lastEval = await this.evaluationRepo.findOne({
      where: { sloId },
      order: { evaluatedAt: 'DESC' },
    });

    return {
      pass_rate_7d: evals7d.length > 0
        ? evals7d.filter((e) => e.passed).length / evals7d.length
        : null,
      pass_rate_30d: evals30d.length > 0
        ? evals30d.filter((e) => e.passed).length / evals30d.length
        : null,
      last_evaluated_at: lastEval?.evaluatedAt?.toISOString() ?? null,
    };
  }

  private toDeclarationDto(entity: SloDeclarationEntity) {
    return {
      id: entity.id,
      product_id: entity.productId,
      org_id: entity.orgId,
      name: entity.name,
      description: entity.description,
      slo_type: entity.sloType,
      metric_name: entity.metricName,
      threshold_operator: entity.thresholdOperator,
      threshold_value: Number(entity.thresholdValue),
      threshold_unit: entity.thresholdUnit,
      evaluation_window_hours: entity.evaluationWindowHours,
      external_system: entity.externalSystem,
      active: entity.active,
      created_at: entity.createdAt.toISOString(),
      updated_at: entity.updatedAt.toISOString(),
    };
  }

  private toEvaluationDto(entity: SloEvaluationEntity) {
    return {
      id: entity.id,
      slo_id: entity.sloId,
      measured_value: Number(entity.measuredValue),
      passed: entity.passed,
      evaluated_at: entity.evaluatedAt.toISOString(),
      evaluated_by: entity.evaluatedBy,
      details: entity.details,
      created_at: entity.createdAt.toISOString(),
    };
  }
}
