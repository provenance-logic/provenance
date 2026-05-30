import { acmeCorpConnectionRefs } from './acme-corp-consent.js';
import { betaIndustriesConnectionRefs } from './beta-industries-consent.js';
import type { SeedConnectionReference } from '../types.js';

export const seedConnectionReferences: SeedConnectionReference[] = [
  ...acmeCorpConnectionRefs,
  ...betaIndustriesConnectionRefs,
];
