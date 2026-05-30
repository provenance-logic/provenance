import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { resolveSeedDeepLink, type DeepLinkRouteMaps } from './resolve-deep-link.js';

const maps: DeepLinkRouteMaps = {
  productRouteBySlug: new Map([
    ['revenue-daily', '/marketplace/org-acme/prod-revenue'],
    ['customer-360', '/marketplace/org-acme/prod-c360'],
  ]),
  agentRouteBySlug: new Map([
    ['acme-marketing-copilot', '/agents/agent-mktg'],
  ]),
};

test('rewrites /marketplace/<slug>/trust to the product detail route (the finance ISE link)', () => {
  assert.equal(
    resolveSeedDeepLink('/marketplace/revenue-daily/trust', maps),
    '/marketplace/org-acme/prod-revenue',
  );
});

test('rewrites single-segment /marketplace/<slug> to the product detail route', () => {
  assert.equal(
    resolveSeedDeepLink('/marketplace/customer-360', maps),
    '/marketplace/org-acme/prod-c360',
  );
});

test('rewrites /agents/<slug> to the agent detail route', () => {
  assert.equal(
    resolveSeedDeepLink('/agents/acme-marketing-copilot', maps),
    '/agents/agent-mktg',
  );
});

test('rewrites /agents/<slug>/<sub> (e.g. connection-references) to the agent detail route', () => {
  assert.equal(
    resolveSeedDeepLink('/agents/acme-marketing-copilot/connection-references', maps),
    '/agents/agent-mktg',
  );
});

test('rewrites /publishing/<slug>/access-requests to the approver Pending Requests page', () => {
  assert.equal(
    resolveSeedDeepLink('/publishing/customer-360/access-requests', maps),
    '/access-requests',
  );
});

test('rewrites /publishing/<slug>/observability to the product detail route', () => {
  assert.equal(
    resolveSeedDeepLink('/publishing/revenue-daily/observability', maps),
    '/marketplace/org-acme/prod-revenue',
  );
});

test('passes governance and already-correct routes through unchanged', () => {
  assert.equal(resolveSeedDeepLink('/governance/compliance', maps), '/governance/compliance');
  assert.equal(resolveSeedDeepLink('/access-requests', maps), '/access-requests');
});

test('unknown product slug degrades to the marketplace list with a warning', () => {
  const warnings: string[] = [];
  assert.equal(
    resolveSeedDeepLink('/marketplace/does-not-exist', maps, (m) => warnings.push(m)),
    '/marketplace',
  );
  assert.equal(warnings.length, 1);
});

test('unknown agent slug degrades to the agents list with a warning', () => {
  const warnings: string[] = [];
  assert.equal(
    resolveSeedDeepLink('/agents/ghost-agent', maps, (m) => warnings.push(m)),
    '/agents',
  );
  assert.equal(warnings.length, 1);
});

test('preserves query strings on passthrough', () => {
  assert.equal(
    resolveSeedDeepLink('/marketplace?replacement_for=x', maps),
    '/marketplace?replacement_for=x',
  );
});

test('leaves empty or relative links untouched', () => {
  assert.equal(resolveSeedDeepLink('', maps), '');
  assert.equal(resolveSeedDeepLink('notifications', maps), 'notifications');
});
