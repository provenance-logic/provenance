import {
  acmeCorpAccessRequests,
  acmeCorpAccessGrants,
} from './acme-corp-access.js';
import {
  betaIndustriesAccessRequests,
  betaIndustriesAccessGrants,
} from './beta-industries-access.js';
import type { SeedAccessRequest, SeedAccessGrant } from '../types.js';

export const seedAccessRequests: SeedAccessRequest[] = [
  ...acmeCorpAccessRequests,
  ...betaIndustriesAccessRequests,
];

export const seedAccessGrants: SeedAccessGrant[] = [
  ...acmeCorpAccessGrants,
  ...betaIndustriesAccessGrants,
];
