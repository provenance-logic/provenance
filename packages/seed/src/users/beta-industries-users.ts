import type { SeedUser } from '../types.js';

export const betaIndustriesUsers: SeedUser[] = [
  {
    email: 'admin@beta.example.com',
    firstName: 'Beatriz',
    lastName: 'Admin',
    password: 'DemoPass123!',
    orgSlug: 'beta-industries',
    roles: ['org_admin'],
  },
  {
    email: 'risk-lead@beta.example.com',
    firstName: 'Raj',
    lastName: 'Patel',
    password: 'DemoPass123!',
    orgSlug: 'beta-industries',
    roles: ['domain_owner'],
    domainSlugs: ['risk'],
  },
  {
    email: 'customer-lead@beta.example.com',
    firstName: 'Camille',
    lastName: 'Okonkwo',
    password: 'DemoPass123!',
    orgSlug: 'beta-industries',
    roles: ['domain_owner'],
    domainSlugs: ['customer'],
  },
  {
    email: 'compliance@beta.example.com',
    firstName: 'Carlos',
    lastName: 'Nguyen',
    password: 'DemoPass123!',
    orgSlug: 'beta-industries',
    roles: ['governance'],
  },
  {
    email: 'analyst@beta.example.com',
    firstName: 'Anya',
    lastName: 'Volkov',
    password: 'DemoPass123!',
    orgSlug: 'beta-industries',
    roles: ['consumer'],
  },
];
