'use strict';

/**
 * @fileoverview ESLint rule that enforces ADR-010's explicit-orgId-filter
 * pattern at the service layer. Detects TypeORM-shaped repository calls
 * whose `where` clause does not include `orgId`, the pattern that
 * surfaced as B-061 (cross-org leak) and B-062 (the deeper RLS-doesn't-
 * load-bear story).
 *
 * Detection is *pattern-based*, not type-based: any call shaped like
 * `<obj>.<somethingRepo>.<repoMethod>(<arg>)` where the arg is an
 * object literal with a `where` key is candidate. This catches both
 * `this.agentRepo.findOne(...)` (the most common shape) and the rarer
 * destructured-repo case via `repos.agentRepo.findOne(...)`.
 *
 * Escape hatch: a magic comment on the line(s) immediately above the
 * call, e.g.
 *
 *   // @cross-tenant-by-design: globally-unique keycloak_subject lookup
 *   const principal = await this.principalRepo.findOne({
 *     where: { keycloakSubject: ctx.keycloakSubject },
 *   });
 *
 * The comment opts that specific call out. Used for Tier-2 sites per the
 * service-org-filter audit (#165): ensurePrincipal helpers, slug-uniqueness
 * checks, org-by-id, marketplace cross-tenant reads, etc.
 *
 * Severity:
 *   - default 'warn' so the audit's 15 Tier-3 sites surface without breaking
 *     CI today. Tighten to 'error' once those land their mechanical cleanup
 *     PRs.
 *
 * Limits:
 *   - Pattern-based: doesn't know which entity is tenant-scoped. We flag
 *     EVERY repo-shaped call without orgId. Magic comments cover the
 *     legitimate exceptions.
 *   - Only handles `findOne` / `find` / `count` / `update` / `delete`
 *     today. `save`, `upsert`, and QueryBuilder calls are out of scope
 *     for this v0.1.
 *
 * References:
 *   - ADR-010 — documents/architecture/adr/ADR-010-rls-by-default.md
 *   - B-062 — documents/bugs/open.md#B-062
 *   - Service audit — documents/audits/service-org-filter-audit-2026-05-22.md
 */

const REPO_METHODS = new Set(['findOne', 'find', 'count', 'update', 'delete']);
// Property name must be exactly `repo` OR end in `Repo` (camelCase).
// `repo` alone is used in services that hold a single repository (e.g.,
// notifications.service.ts), while `xxxRepo` is the multi-repo convention.
const REPO_NAME_RE = /^repo$|Repo$/;
const ESCAPE_PATTERN = /@cross-tenant-by-design\b/;

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Enforce explicit `orgId` in where clauses on TypeORM repository calls (ADR-010).',
      recommended: false,
    },
    schema: [
      {
        type: 'object',
        properties: {
          // Allow projects to extend the list of method names treated as
          // repo calls (e.g. add `save` if a project's convention warrants
          // it). Default covers the audit-confirmed surface area.
          extraMethods: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      missingOrgId:
        'Repository call `{{repo}}.{{method}}` is missing `orgId` in its `where` clause. ' +
        'ADR-010 requires every tenant-scoped service query to filter on `orgId = ctx.orgId` explicitly. ' +
        'If this query is intentionally cross-tenant, add a `// @cross-tenant-by-design: <reason>` comment ' +
        'on the line above the call.',
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const methods = new Set([...REPO_METHODS, ...(options.extraMethods || [])]);
    const sourceCode = context.getSourceCode();

    return {
      CallExpression(node) {
        // Must be a member-expression call: <something>.<method>(...)
        if (node.callee.type !== 'MemberExpression') return;

        // The method name must be in the repo-method allowlist.
        const methodNode = node.callee.property;
        if (methodNode.type !== 'Identifier') return;
        if (!methods.has(methodNode.name)) return;

        // The object must itself be a member-expression whose property
        // ends in 'Repo' (e.g. `this.agentRepo`, `repos.userRepo`).
        const objectNode = node.callee.object;
        if (objectNode.type !== 'MemberExpression') return;
        if (objectNode.property.type !== 'Identifier') return;
        if (!REPO_NAME_RE.test(objectNode.property.name)) return;

        // First argument must be an object literal we can inspect.
        // findOne / find / count / delete take a FindManyOptions-shape;
        // update takes (criteria, partial) — for `update`, the criteria
        // is the first argument and we look at its shape directly
        // (objects without `where:` are also OK if they include `orgId`).
        const firstArg = node.arguments[0];
        if (!firstArg) return;
        if (firstArg.type !== 'ObjectExpression') return;

        // For update/delete, the first arg can be a criteria object directly
        // (no `where` wrapper). For find/findOne/count, the canonical shape is
        // { where: {...} }. Try both: prefer `where`-wrapped, fall back to
        // top-level keys.
        const whereProp = findProperty(firstArg, 'where');
        const criteriaObject =
          whereProp && whereProp.value.type === 'ObjectExpression'
            ? whereProp.value
            : firstArg;

        if (hasKey(criteriaObject, 'orgId')) return;

        // Check for escape-hatch magic comment on the lines above.
        if (hasCrossTenantComment(sourceCode, node)) return;

        context.report({
          node,
          messageId: 'missingOrgId',
          data: {
            repo: objectNode.property.name,
            method: methodNode.name,
          },
        });
      },
    };
  },
};

function findProperty(objectExpression, name) {
  for (const prop of objectExpression.properties) {
    if (prop.type !== 'Property') continue;
    if (prop.key.type === 'Identifier' && prop.key.name === name) return prop;
    if (prop.key.type === 'Literal' && prop.key.value === name) return prop;
  }
  return null;
}

function hasKey(objectExpression, name) {
  return findProperty(objectExpression, name) !== null;
}

function hasCrossTenantComment(sourceCode, node) {
  // Scan all comments and find any with the magic phrase that ends within
  // a reasonable window above the call's start line. The window is
  // generous (8 lines) to accommodate multi-line `//` magic-comment blocks
  // that explain the reason in prose. Line-based scanning avoids depending
  // on parent-link availability in the visited AST, which varies between
  // parsers / RuleTester setups.
  const callLine = node.loc.start.line;
  const allComments = sourceCode.getAllComments();
  for (const c of allComments) {
    if (c.loc.end.line < callLine - 8) continue;
    if (c.loc.end.line >= callLine) continue;
    if (ESCAPE_PATTERN.test(c.value)) return true;
  }
  return false;
}
