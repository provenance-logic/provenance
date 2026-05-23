import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  PrincipalPreferences,
  PrincipalPreferencesResponse,
} from '@provenance/types';
import { PrincipalPreferencesEntity } from '../organizations/entities/principal-preferences.entity.js';

// F7.46 — per-principal preferences storage. The current consumer is the
// onboarding wizard; the table is shaped generically so future preference
// surfaces (UI layout, default filters, etc.) can land without a migration
// per preference.
//
// Authorization: every method takes the principal id directly. The
// controller pulls it from the verified request context — a principal
// can only ever read or write its own preferences.
//
// Merge semantics: PATCH deep-merges top-level keys. Nested objects
// (e.g. `onboarding`) are replaced as a whole when supplied, rather than
// merged recursively. This is enough for the wizard, which always writes
// the full OnboardingState shape, and avoids the complexity of a generic
// deep merge that would have to deal with arrays and tombstones.
@Injectable()
export class PreferencesService {
  constructor(
    @InjectRepository(PrincipalPreferencesEntity)
    private readonly prefsRepo: Repository<PrincipalPreferencesEntity>,
  ) {}

  async getPreferences(
    orgId: string,
    principalId: string,
  ): Promise<PrincipalPreferencesResponse> {
    const row = await this.prefsRepo.findOne({ where: { principalId, orgId } });
    if (!row) {
      // No row yet means default empty preferences. The wizard treats
      // a missing onboarding key as "fresh user, show the wizard."
      // Don't auto-insert here — let the first PATCH create the row.
      return {
        preferences: {},
        updatedAt: new Date(0).toISOString(),
      };
    }
    return {
      preferences: row.preferences ?? {},
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async updatePreferences(
    orgId: string,
    principalId: string,
    patch: Partial<PrincipalPreferences>,
  ): Promise<PrincipalPreferencesResponse> {
    const existing = await this.prefsRepo.findOne({ where: { principalId, orgId } });
    if (existing) {
      existing.preferences = { ...existing.preferences, ...patch };
      const saved = await this.prefsRepo.save(existing);
      return {
        preferences: saved.preferences,
        updatedAt: saved.updatedAt.toISOString(),
      };
    }
    const created = this.prefsRepo.create({
      principalId,
      orgId,
      preferences: patch as PrincipalPreferences,
    });
    const saved = await this.prefsRepo.save(created);
    return {
      preferences: saved.preferences,
      updatedAt: saved.updatedAt.toISOString(),
    };
  }
}
