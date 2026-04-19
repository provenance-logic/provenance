import { acmeCorpProducts } from './acme-corp-products.js';
import { betaIndustriesProducts } from './beta-industries-products.js';
import type { SeedProduct } from '../types.js';

export const seedProducts: SeedProduct[] = [...acmeCorpProducts, ...betaIndustriesProducts];
