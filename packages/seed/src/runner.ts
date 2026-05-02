import type { SeedConfig } from './config.js';
import type { Logger } from './logger.js';
import type { ApiClient } from './api-client.js';
import type { KeycloakAdminClient } from './keycloak-client.js';
import { seedOrgs } from './orgs/index.js';
import { seedUsers } from './users/index.js';
import { seedPolicies } from './policies/index.js';
import { seedProducts } from './products/index.js';
import { seedAgents } from './agents/index.js';
import { seedLineageEdges } from './lineage/index.js';
import { seedSlos } from './slos/index.js';
import { seedAccessRequests, seedAccessGrants } from './access/index.js';

interface RunContext {
  config: SeedConfig;
  logger: Logger;
  api: ApiClient;
  keycloak: KeycloakAdminClient;
}

// Negative `days` produces a future timestamp.
function daysAgoIso(days: number): string {
  const ms = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}

export async function runSeed(ctx: RunContext): Promise<void> {
  const { logger } = ctx;

  logger.info('seed: orgs');
  const orgIdBySlug = new Map<string, string>();
  for (const org of seedOrgs) {
    const res = await ctx.api.post<{ id: string }>('/seed/organizations', {
      slug: org.slug,
      name: org.name,
      description: org.description,
      contactEmail: org.contactEmail,
    });
    orgIdBySlug.set(org.slug, res.id);
  }

  // Principals must be seeded before domains so /seed/domains can resolve the
  // ownerEmail to an existing principal. Two-pass within /seed/principals
  // (principal first, role assignments second) means non-domain roles land
  // on the first pass; domain_owner role bindings get filled in on the second
  // pass below, after domains exist.
  logger.info('seed: users');
  const principalIdByEmail = new Map<string, string>();
  for (const user of seedUsers) {
    const orgId = orgIdBySlug.get(user.orgSlug);
    if (!orgId) throw new Error(`unknown org slug: ${user.orgSlug}`);
    const kc = await ctx.keycloak.ensureUser({
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      password: user.password,
      attributes: {
        provenance_org_id: orgId,
        provenance_principal_type: 'human',
      },
    });
    const principal = await ctx.api.post<{ id: string }>('/seed/principals', {
      orgId,
      keycloakUserId: kc.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles: user.roles,
      domainSlugs: user.domainSlugs ?? [],
    });
    principalIdByEmail.set(user.email, principal.id);
  }

  logger.info('seed: domains');
  for (const org of seedOrgs) {
    const orgId = orgIdBySlug.get(org.slug);
    if (!orgId) throw new Error(`unknown org slug: ${org.slug}`);
    for (const domain of org.domains) {
      await ctx.api.post('/seed/domains', {
        orgId,
        slug: domain.slug,
        name: domain.name,
        description: domain.description,
        ownerEmail: domain.ownerEmail,
      });
    }
  }

  // Second pass: domain_owner role bindings now that domains exist. The
  // /seed/principals endpoint is idempotent — re-posting only creates the
  // missing role rows for users whose domain_owner role couldn't bind on
  // the first pass.
  logger.info('seed: domain role bindings');
  for (const user of seedUsers) {
    if (!user.roles.includes('domain_owner')) continue;
    const orgId = orgIdBySlug.get(user.orgSlug);
    if (!orgId) throw new Error(`unknown org slug: ${user.orgSlug}`);
    const kc = await ctx.keycloak.ensureUser({
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      password: user.password,
      attributes: {
        provenance_org_id: orgId,
        provenance_principal_type: 'human',
      },
    });
    await ctx.api.post('/seed/principals', {
      orgId,
      keycloakUserId: kc.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles: user.roles,
      domainSlugs: user.domainSlugs ?? [],
    });
  }

  logger.info('seed: policies');
  for (const policy of seedPolicies) {
    const orgId = orgIdBySlug.get(policy.orgSlug);
    if (!orgId) throw new Error(`unknown org slug: ${policy.orgSlug}`);
    await ctx.api.post('/seed/policies', {
      orgId,
      policyKey: policy.policyKey,
      title: policy.title,
      description: policy.description,
      appliesTo: policy.appliesTo,
      regoModule: policy.regoModule,
    });
  }

  logger.info('seed: products');
  const productIdBySlug = new Map<string, string>();
  for (const product of seedProducts) {
    const orgId = orgIdBySlug.get(product.orgSlug);
    if (!orgId) throw new Error(`unknown org slug: ${product.orgSlug}`);
    const res = await ctx.api.post<{ id: string }>('/seed/products', {
      orgId,
      domainSlug: product.domainSlug,
      slug: product.slug,
      name: product.name,
      description: product.description,
      ownerEmail: product.ownerEmail,
      tags: product.tags,
      lifecycleState: product.lifecycleState,
      freshnessSla: product.freshnessSla,
      refreshCadence: product.refreshCadence,
      ports: product.ports,
    });
    productIdBySlug.set(product.slug, res.id);
  }

  logger.info('seed: agents');
  for (const agent of seedAgents) {
    const orgId = orgIdBySlug.get(agent.orgSlug);
    if (!orgId) throw new Error(`unknown org slug: ${agent.orgSlug}`);
    const kcClient = await ctx.keycloak.ensureClientCredentialsClient({
      clientId: `agent-${agent.agentSlug}`,
      name: agent.displayName,
      serviceAccountAttributes: {
        provenance_org_id: orgId,
        provenance_principal_type: 'ai_agent',
        provenance_agent_slug: agent.agentSlug,
      },
    });
    await ctx.api.post('/seed/agents', {
      orgId,
      agentSlug: agent.agentSlug,
      displayName: agent.displayName,
      description: agent.description,
      trustClassification: agent.trustClassification,
      oversightContactEmail: agent.oversightContactEmail,
      keycloakClientId: kcClient.clientId,
      keycloakClientSecret: kcClient.clientSecret,
    });
  }

  logger.info('seed: lineage');
  for (const edge of seedLineageEdges) {
    const fromId = productIdBySlug.get(edge.fromProductSlug);
    const toId = productIdBySlug.get(edge.toProductSlug);
    if (!fromId || !toId) {
      throw new Error(`lineage edge references unknown product: ${edge.fromProductSlug} -> ${edge.toProductSlug}`);
    }
    await ctx.api.post('/seed/lineage-edges', {
      fromProductId: fromId,
      toProductId: toId,
      edgeType: edge.edgeType,
      description: edge.description,
    });
  }

  logger.info('seed: slos');
  // Slug → orgId map so SLOs can resolve their product's org without
  // re-fetching. Walks the product seed list in order to avoid a second
  // map.
  const orgIdByProductSlug = new Map<string, string>();
  for (const product of seedProducts) {
    const orgId = orgIdBySlug.get(product.orgSlug);
    if (!orgId) continue;
    orgIdByProductSlug.set(product.slug, orgId);
  }
  for (const slo of seedSlos) {
    const productId = productIdBySlug.get(slo.productSlug);
    const orgId = orgIdByProductSlug.get(slo.productSlug);
    if (!productId || !orgId) {
      throw new Error(`slo references unknown product: ${slo.productSlug}`);
    }
    await ctx.api.post('/seed/slos', {
      orgId,
      productId,
      name: slo.name,
      description: slo.description,
      sloType: slo.sloType,
      metricName: slo.metricName,
      thresholdOperator: slo.thresholdOperator,
      thresholdValue: slo.thresholdValue,
      thresholdUnit: slo.thresholdUnit,
      evaluationWindowHours: slo.evaluationWindowHours,
    });
  }

  logger.info('seed: access requests');
  for (const req of seedAccessRequests) {
    const productId = productIdBySlug.get(req.productSlug);
    const orgId = orgIdByProductSlug.get(req.productSlug);
    const requesterPrincipalId = principalIdByEmail.get(req.requesterEmail);
    if (!productId || !orgId) {
      throw new Error(`access request references unknown product: ${req.productSlug}`);
    }
    if (!requesterPrincipalId) {
      throw new Error(`access request references unknown requester: ${req.requesterEmail}`);
    }
    const requestedAt = daysAgoIso(req.submittedDaysAgo);
    const resolvedAt = req.resolvedDaysAgo !== undefined ? daysAgoIso(req.resolvedDaysAgo) : undefined;
    const resolverId = req.resolverEmail ? principalIdByEmail.get(req.resolverEmail) : undefined;
    if (req.resolverEmail && !resolverId) {
      throw new Error(`access request references unknown resolver: ${req.resolverEmail}`);
    }
    await ctx.api.post('/seed/access-requests', {
      orgId,
      productId,
      requesterPrincipalId,
      justification: req.justification,
      status: req.status,
      requestedAt,
      resolvedAt,
      resolvedByPrincipalId: resolverId,
      resolutionNote: req.resolutionNote,
    });
  }

  logger.info('seed: access grants');
  for (const grant of seedAccessGrants) {
    const productId = productIdBySlug.get(grant.productSlug);
    const orgId = orgIdByProductSlug.get(grant.productSlug);
    const granteeId = principalIdByEmail.get(grant.granteeEmail);
    const grantedById = principalIdByEmail.get(grant.grantedByEmail);
    if (!productId || !orgId) {
      throw new Error(`access grant references unknown product: ${grant.productSlug}`);
    }
    if (!granteeId) {
      throw new Error(`access grant references unknown grantee: ${grant.granteeEmail}`);
    }
    if (!grantedById) {
      throw new Error(`access grant references unknown grantor: ${grant.grantedByEmail}`);
    }
    await ctx.api.post('/seed/access-grants', {
      orgId,
      productId,
      granteePrincipalId: granteeId,
      grantedByPrincipalId: grantedById,
      grantedAt: daysAgoIso(grant.grantedDaysAgo),
      expiresAt: grant.expiresInDays !== undefined ? daysAgoIso(-grant.expiresInDays) : undefined,
    });
  }

  logger.info('seed: trust score kickoff');
  for (const slug of productIdBySlug.keys()) {
    await ctx.api.post(`/seed/trust-score-recompute/${productIdBySlug.get(slug)}`, {});
  }

  logger.info('seed complete');
}
