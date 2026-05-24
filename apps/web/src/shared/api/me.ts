import { api } from './client.js';
import type { MeProfileResponse } from '@provenance/types';

// F7.48 — Provenance Account Surface.
// `GET /me` returns the data the AccountPage needs to render the
// current caller's profile. Sibling preferences calls live in
// `./preferences.ts` (F7.46 onboarding wizard state).
export const meApi = {
  getProfile: (): Promise<MeProfileResponse> => api.get<MeProfileResponse>('/me'),
};
