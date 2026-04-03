import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ComplianceStateEntity } from '../governance/entities/compliance-state.entity.js';
import type { ComplianceStateValue } from '@provenance/types';

@Injectable()
export class TrustScoreService {
  constructor(
    @InjectRepository(ComplianceStateEntity)
    private readonly complianceRepo: Repository<ComplianceStateEntity>,
  ) {}

  /**
   * Phase 2: trust score derived from governance compliance state only.
   * Lineage and SLO contributions are Phase 3.
   */
  async computeTrustScore(orgId: string, productId: string): Promise<number> {
    const state = await this.complianceRepo.findOne({
      where: { orgId, productId },
    });
    if (!state) {
      // No compliance record means no policies have been applied — treat as fully compliant.
      return 1.0;
    }
    return this.stateToScore(state.state);
  }

  private stateToScore(state: ComplianceStateValue): number {
    switch (state) {
      case 'compliant':      return 1.0;
      case 'grace_period':   return 0.75;
      case 'drift_detected': return 0.5;
      case 'non_compliant':  return 0.25;
      default:               return 1.0;
    }
  }
}
