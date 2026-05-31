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
import { seedConnectionReferences } from './consent/index.js';
import { seedNotifications } from './notifications/index.js';
import { resolveSeedDeepLink } from './notifications/resolve-deep-link.js';

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

// Like daysAgoIso, but rounded to midnight UTC of that day.
// Used for rows where the seed's idempotency check matches on
// `evaluated_at` (or equivalent) — re-runs must produce the same
// timestamp or the lookup misses and a duplicate row is inserted.
function daysAgoMidnightIso(days: number): string {
  const now = new Date();
  const utcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return new Date(utcMidnight - days * 24 * 60 * 60 * 1000).toISOString();
}

// Generate a measurement that satisfies (or violates) the SLO's
// threshold, depending on `shouldPass`. Used to produce realistic
// historical evaluation rows during seeding without authoring each
// row by hand.
function computeSeedSloMeasurement(
  operator: 'lt' | 'lte' | 'gt' | 'gte' | 'eq',
  threshold: number,
  shouldPass: boolean,
): number {
  // Multiplier choice keeps the measurement clearly on the
  // intended side of the threshold, but never absurdly far away.
  // Ratios above 1.0 are clamped at the call site if needed.
  if (operator === 'gte' || operator === 'gt') {
    const multiplier = shouldPass ? 1.02 : 0.93;
    const value = threshold * multiplier;
    // Ratios (where threshold is between 0 and 1) clamp to 1.0.
    return threshold <= 1 ? Math.min(value, 1.0) : round2(value);
  }
  if (operator === 'lt' || operator === 'lte') {
    const multiplier = shouldPass ? 0.85 : 1.15;
    return round2(threshold * multiplier);
  }
  // 'eq' is unusual; return the threshold itself for a "pass"
  // evaluation, or threshold * 1.05 for a "fail."
  return shouldPass ? threshold : round2(threshold * 1.05);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Products deliberately staged as untrustworthy so the demo can show a REAL,
// engine-computed trust-score collapse (into the critical/red band) instead of
// a synthetic number. Their SLO evaluations are seeded as breaching and their
// compliance state is set non_compliant; the trust engine then computes the
// low score from that data, and the @Cron recompute keeps it there because the
// data genuinely says so. A declining backdated history is seeded separately
// (see the trust-score step) so the trend chart leads down into the red value.
const DEGRADED_TRUST_PRODUCTS = new Set<string>(['revenue-daily']);

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
  // product slug -> concrete /marketplace/:orgId/:productId route, used to
  // resolve authored notification deep links to real UUID routes (see
  // resolve-deep-link.ts — the fix for the slug-link 500s).
  const productRouteBySlug = new Map<string, string>();
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
    productRouteBySlug.set(product.slug, `/marketplace/${orgId}/${res.id}`);
  }

  logger.info('seed: agents');
  // agent.agentId is the principal identifier throughout the platform — the
  // /seed/agents endpoint creates the matching identity.principals row so the
  // FK on access_grants.grantee_principal_id and
  // consent.connection_references.agent_id is satisfiable. Map agentSlug →
  // agentId so the grant + connection-reference walks below can resolve agent
  // grantees the same way principalIdByEmail resolves human ones.
  const agentIdByAgentSlug = new Map<string, string>();
  // agent slug -> concrete /agents/:agentId route, for notification deep-link
  // resolution (see resolve-deep-link.ts).
  const agentRouteBySlug = new Map<string, string>();
  for (const agent of seedAgents) {
    const orgId = orgIdBySlug.get(agent.orgSlug);
    if (!orgId) throw new Error(`unknown org slug: ${agent.orgSlug}`);
    // The /seed/agents endpoint now provisions the Keycloak client itself via
    // KeycloakAdminService.createAgentClient(agentId, orgId, `agent-<slug>`).
    // This ensures the `agent_id` claim in the JWT equals the platform agentId
    // (which access grants reference), and that the token carries the correct
    // `provenance_principal_type` claim. See B-076.
    const res = await ctx.api.post<{ id: string }>('/seed/agents', {
      orgId,
      agentSlug: agent.agentSlug,
      displayName: agent.displayName,
      description: agent.description,
      trustClassification: agent.trustClassification,
      oversightContactEmail: agent.oversightContactEmail,
    });
    agentIdByAgentSlug.set(agent.agentSlug, res.id);
    agentRouteBySlug.set(agent.agentSlug, `/agents/${res.id}`);
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
    const decl = await ctx.api.post<{ id: string }>('/seed/slos', {
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

    // Generate 7 daily evaluations.
    //
    // Healthy products: 6 passing + 1 failing 2 days ago — story "one bad day
    // mid-week, recovered" — so the summary endpoint reports pass_rate_7d ≈
    // 85.7%.
    //
    // Degraded products (see DEGRADED_TRUST_PRODUCTS): only the oldest eval
    // passes — SLOs began breaching ~a week ago and never recovered, so
    // pass_rate_7d ≈ 14%. Combined with the non-compliant compliance state
    // staged below, this drives the trust engine to a real critical/red score
    // (the slo + governance components both collapse) rather than a synthetic
    // number the live recompute would overwrite.
    const degraded = DEGRADED_TRUST_PRODUCTS.has(slo.productSlug);
    for (let i = 0; i < 7; i++) {
      const daysAgo = 7 - i;
      const isFailingSlot = degraded ? daysAgo !== 7 : daysAgo === 2;
      const measuredValue = computeSeedSloMeasurement(
        slo.thresholdOperator,
        slo.thresholdValue,
        !isFailingSlot,
      );
      await ctx.api.post('/seed/slo-evaluations', {
        sloId: decl.id,
        orgId,
        measuredValue,
        passed: !isFailingSlot,
        evaluatedAt: daysAgoMidnightIso(daysAgo),
        evaluatedBy: 'seed-runner',
        details: {
          source: 'seed',
          metricName: slo.metricName,
        },
      });
    }
  }

  // Stage the deliberately untrustworthy products as non_compliant so the
  // governance trust component (the heaviest weight, 0.35) collapses to 0.0.
  // Done after SLOs so the recompute these trigger already sees the breaching
  // eval data. Together with the breaching SLOs this is what lands the
  // engine-computed score in the critical/red band — a coherent "failed
  // governance + blown SLOs" story, not a faked number.
  logger.info('seed: compliance overrides');
  for (const slug of DEGRADED_TRUST_PRODUCTS) {
    const productId = productIdBySlug.get(slug);
    if (!productId) continue;
    await ctx.api.post(`/seed/compliance-state/${productId}`, {
      state: 'non_compliant',
      violations: [
        {
          policyDomain: 'slo',
          ruleId: 'slo.freshness.breaching',
          detail: 'Daily reconciliation freshness SLO has been breaching for 6 consecutive days.',
        },
        {
          policyDomain: 'lineage',
          ruleId: 'lineage.completeness.stale',
          detail: 'Upstream lineage has not been refreshed since the freshness incident began.',
        },
      ],
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
    // XOR: exactly one of granteeEmail / granteeAgentSlug must be set.
    if (!grant.granteeEmail === !grant.granteeAgentSlug) {
      throw new Error(
        `access grant must set exactly one of granteeEmail or granteeAgentSlug: ${grant.productSlug}`,
      );
    }
    const granteeId = grant.granteeAgentSlug
      ? agentIdByAgentSlug.get(grant.granteeAgentSlug)
      : principalIdByEmail.get(grant.granteeEmail!);
    const grantedById = principalIdByEmail.get(grant.grantedByEmail);
    if (!productId || !orgId) {
      throw new Error(`access grant references unknown product: ${grant.productSlug}`);
    }
    if (!granteeId) {
      throw new Error(
        `access grant references unknown grantee: ${grant.granteeAgentSlug ?? grant.granteeEmail}`,
      );
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

  logger.info('seed: connection references');
  // Connection references are the per-use-case authorization on top of the
  // grant (Domain 12 — both required for any product-bound MCP tool call).
  // The seed walks references after grants so each ref can look up the grant
  // it composes with via the /seed/connection-references endpoint's internal
  // resolution.
  //
  // Inline content validation — the API endpoint enforces the same rules but
  // this gives a developer-friendly error tied to the seed entry rather than
  // an opaque HTTP 4xx during seed-time debugging.
  const VALID_USE_CASES = new Set([
    'Reporting and Analytics', 'Model Training', 'Pipeline Input',
    'Audit and Compliance', 'Product Development', 'Operational Monitoring',
    'Research', 'Integration',
  ]);
  for (const ref of seedConnectionReferences) {
    if (ref.purposeElaboration.length < 50) {
      throw new Error(
        `connection reference ${ref.agentSlug}/${ref.productSlug}: purposeElaboration must be ≥ 50 chars (got ${ref.purposeElaboration.length})`,
      );
    }
    if (!VALID_USE_CASES.has(ref.useCaseCategory)) {
      throw new Error(
        `connection reference ${ref.agentSlug}/${ref.productSlug}: invalid useCaseCategory '${ref.useCaseCategory}'`,
      );
    }
    if (ref.approvedScope.ports.length === 0) {
      throw new Error(
        `connection reference ${ref.agentSlug}/${ref.productSlug}: approvedScope.ports must be non-empty`,
      );
    }
    if (ref.requestedDurationDays <= 0 || ref.requestedDaysAgo < 1) {
      throw new Error(
        `connection reference ${ref.agentSlug}/${ref.productSlug}: requestedDurationDays must be > 0 and requestedDaysAgo must be >= 1`,
      );
    }
  }
  for (const ref of seedConnectionReferences) {
    const productId = productIdBySlug.get(ref.productSlug);
    const orgId = orgIdByProductSlug.get(ref.productSlug);
    const agentId = agentIdByAgentSlug.get(ref.agentSlug);
    const approverId = principalIdByEmail.get(ref.approverEmail);
    if (!productId || !orgId) {
      throw new Error(`connection reference references unknown product: ${ref.productSlug}`);
    }
    if (!agentId) {
      throw new Error(`connection reference references unknown agent: ${ref.agentSlug}`);
    }
    if (!approverId) {
      throw new Error(`connection reference references unknown approver: ${ref.approverEmail}`);
    }
    // Approval lands one day after request; activation = approval (no
    // grace-period delay). Expiry is requestedDurationDays from the approval
    // moment — produces a stable absolute timestamp so re-runs are idempotent.
    const approvalDaysAgo = Math.max(0, ref.requestedDaysAgo - 1);
    const expiresFromNowDays = ref.requestedDurationDays - approvalDaysAgo;
    await ctx.api.post('/seed/connection-references', {
      orgId,
      agentPrincipalId: agentId,
      productId,
      approverPrincipalId: approverId,
      useCaseCategory: ref.useCaseCategory,
      purposeElaboration: ref.purposeElaboration,
      approvedScope: ref.approvedScope,
      requestedDurationDays: ref.requestedDurationDays,
      requestedAt: daysAgoIso(ref.requestedDaysAgo),
      approvedAt: daysAgoIso(approvalDaysAgo),
      expiresAt: daysAgoIso(-expiresFromNowDays),
    });
  }

  logger.info('seed: notifications');
  // Resolve each recipient email back to (orgId, principalId).
  // The seed user list and the principal map were both built earlier,
  // so this is just lookups.
  const orgIdByUserEmail = new Map<string, string>();
  for (const user of seedUsers) {
    const orgId = orgIdBySlug.get(user.orgSlug);
    if (orgId) orgIdByUserEmail.set(user.email, orgId);
  }
  for (const notif of seedNotifications) {
    const recipientId = principalIdByEmail.get(notif.recipientEmail);
    const orgId = orgIdByUserEmail.get(notif.recipientEmail);
    if (!recipientId || !orgId) {
      throw new Error(`notification references unknown recipient: ${notif.recipientEmail}`);
    }
    // Authored deep links are slug-based for readability; rewrite them to
    // concrete UUID routes now that products + agents exist. Without this the
    // router binds slugs to :orgId/:productId and the get-product API 500s on
    // the non-UUID value (the finance-lead "trust score" notification ISE).
    const deepLink = resolveSeedDeepLink(
      notif.deepLink,
      { productRouteBySlug, agentRouteBySlug },
      (msg) => logger.warn(msg),
    );
    await ctx.api.post('/seed/notifications', {
      orgId,
      recipientPrincipalId: recipientId,
      category: notif.category,
      payload: notif.payload,
      deepLink,
      dedupKey: `seed:notif:${notif.seedKey}`,
      createdAt: daysAgoIso(notif.createdDaysAgo),
      readAt: notif.readDaysAgo !== undefined ? daysAgoIso(notif.readDaysAgo) : undefined,
    });
  }

  logger.info('seed: trust score');
  // The finance/governance "trust collapsed" notifications need the trust VIEW
  // to actually show a drop. Earlier attempts seeded a synthetic current score,
  // but the live trust engine (event-driven + @Cron every 5 min) recomputes
  // from real data and overwrites it. So instead we degrade the underlying DATA
  // (breaching SLOs + non_compliant state, staged above) and let the engine
  // compute the low/red score itself — then it stays low because the data says
  // so. Here we only seed a BACK-DATED declining history so the trend chart has
  // a downward shape leading into that real current value, and recompute EVERY
  // product so the current score is always the genuine engine value.
  const TRUST_HISTORY: Record<string, { score: number; daysAgo: number }[]> = {
    // Declining trajectory for revenue-daily, leading down into the real
    // critical/red score (~0.32) the engine now computes from its degraded
    // data. The final, current point is the live recompute below — not seeded.
    'revenue-daily': [
      { score: 0.91, daysAgo: 14 },
      { score: 0.82, daysAgo: 9 },
      { score: 0.64, daysAgo: 4 },
      { score: 0.45, daysAgo: 2 },
    ],
  };
  for (const [slug, id] of productIdBySlug.entries()) {
    const trajectory = TRUST_HISTORY[slug];
    if (trajectory) {
      for (const point of trajectory) {
        await ctx.api.post(`/seed/trust-score-history/${id}`, point);
      }
    }
    // Recompute every product — including trajectory products — so the CURRENT
    // score is the real engine value. For revenue-daily that lands red; the
    // back-dated points above give the chart its declining lead-in.
    await ctx.api.post(`/seed/trust-score-recompute/${id}`, {});
  }

  logger.info('seed complete');
}
