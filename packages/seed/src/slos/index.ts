import { acmeCorpSlos } from './acme-corp-slos.js';
import { betaIndustriesSlos } from './beta-industries-slos.js';
import type { SeedSlo } from '../types.js';

export const seedSlos: SeedSlo[] = [...acmeCorpSlos, ...betaIndustriesSlos];
