import { api } from './client.js';
import type {
  PrincipalPreferences,
  PrincipalPreferencesResponse,
} from '@provenance/types';

// F7.46 — per-principal preferences. Initial consumer is the onboarding
// wizard's progress state; the same endpoint is the right place to
// drop other per-user UI preferences as they come up.
export const preferencesApi = {
  get: () => api.get<PrincipalPreferencesResponse>('/me/preferences'),

  patch: (preferences: Partial<PrincipalPreferences>) =>
    api.patch<PrincipalPreferencesResponse>('/me/preferences', { preferences }),
};
