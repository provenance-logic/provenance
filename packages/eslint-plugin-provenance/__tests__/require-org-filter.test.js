'use strict';

const { RuleTester } = require('eslint');
const rule = require('../lib/require-org-filter.js');

const ruleTester = new RuleTester({
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

ruleTester.run('require-org-filter', rule, {
  valid: [
    // The canonical safe pattern.
    {
      code: 'await this.agentRepo.findOne({ where: { agentId, orgId } });',
    },

    // orgId as first key.
    {
      code: 'await this.productRepo.findOne({ where: { orgId, productId } });',
    },

    // Composite key including orgId.
    {
      code: 'await this.grantRepo.find({ where: { orgId: ctx.orgId, productId, granteePrincipalId } });',
    },

    // count() and delete() with orgId.
    {
      code: 'await this.repo.count({ where: { orgId, status: "active" } });',
    },
    {
      code: 'await this.repo.delete({ orgId, id });',
    },

    // update(): criteria object with orgId (no `where` wrapper).
    {
      code: 'await this.repo.update({ id, orgId }, { readAt: new Date() });',
    },

    // Not a repo call (property doesn't end in 'Repo').
    {
      code: 'await this.keycloak.findUser({ where: { id } });',
    },

    // Not in the method allowlist.
    {
      code: 'await this.repo.someOtherMethod({ where: { id } });',
    },

    // Escape hatch — magic comment on the line above.
    {
      code: [
        '// @cross-tenant-by-design: globally-unique keycloak_subject lookup',
        'const principal = await this.principalRepo.findOne({ where: { keycloakSubject } });',
      ].join('\n'),
    },

    // Escape hatch — comment can be multi-line above and include a reason.
    {
      code: [
        '// Pre-org bootstrap: slug uniqueness check before any org exists.',
        '// @cross-tenant-by-design: org slug uniqueness check pre-creation',
        'const existing = await this.orgRepo.findOne({ where: { slug: dto.slug } });',
      ].join('\n'),
    },

    // Block-comment escape hatch.
    {
      code: [
        '/* @cross-tenant-by-design: marketplace global lookup */',
        'const product = await this.productRepo.findOne({ where: { id: productId } });',
      ].join('\n'),
    },
  ],

  invalid: [
    // Missing orgId on findOne — the agents.service.ts pre-#161 shape.
    {
      code: 'await this.agentRepo.findOne({ where: { agentId } });',
      errors: [
        {
          messageId: 'missingOrgId',
          data: { repo: 'agentRepo', method: 'findOne' },
        },
      ],
    },

    // Missing orgId on find().
    {
      code: 'await this.evaluationRepo.find({ where: { sloId } });',
      errors: [{ messageId: 'missingOrgId' }],
    },

    // Missing orgId on count().
    {
      code: 'await this.exceptionRepo.count({ where: { revokedAt: null } });',
      errors: [{ messageId: 'missingOrgId' }],
    },

    // update() with criteria object missing orgId.
    {
      code: 'await this.repo.update({ id: row.id }, { readAt });',
      errors: [{ messageId: 'missingOrgId' }],
    },

    // A nearby comment that ISN'T the magic phrase doesn't waive the rule.
    {
      code: [
        '// This is just a regular comment about something.',
        'const x = await this.principalRepo.findOne({ where: { keycloakSubject } });',
      ].join('\n'),
      errors: [{ messageId: 'missingOrgId' }],
    },

    // Escape comment too far above (5 lines) doesn't apply.
    {
      code: [
        '// @cross-tenant-by-design: ok here',
        'function unrelated() { return 1; }',
        'function alsoUnrelated() { return 2; }',
        'function yetAnother() { return 3; }',
        '',
        'const x = await this.repo.findOne({ where: { id } });',
      ].join('\n'),
      errors: [{ messageId: 'missingOrgId' }],
    },
  ],
});

// eslint's RuleTester throws on first failure, so reaching this line means all passed.
// eslint-disable-next-line no-console
console.log('require-org-filter: all valid and invalid cases passed');
