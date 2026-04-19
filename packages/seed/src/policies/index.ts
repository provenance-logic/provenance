import { acmeCorpPolicies } from './acme-corp-policies.js';
import { betaIndustriesPolicies } from './beta-industries-policies.js';
import type { SeedPolicy } from '../types.js';

export const seedPolicies: SeedPolicy[] = [...acmeCorpPolicies, ...betaIndustriesPolicies];
