import { acmeCorpUsers } from './acme-corp-users.js';
import { betaIndustriesUsers } from './beta-industries-users.js';
import type { SeedUser } from '../types.js';

export const seedUsers: SeedUser[] = [...acmeCorpUsers, ...betaIndustriesUsers];
