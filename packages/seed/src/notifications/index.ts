import { acmeCorpNotifications } from './acme-corp-notifications.js';
import { betaIndustriesNotifications } from './beta-industries-notifications.js';
import type { SeedNotification } from '../types.js';

export const seedNotifications: SeedNotification[] = [
  ...acmeCorpNotifications,
  ...betaIndustriesNotifications,
];
