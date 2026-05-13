import { describe, it, expect, jest } from '@jest/globals';
import type { AxiosInstance } from 'axios';
import { InternalControlPlaneClient } from './internal-control-plane.client.js';

// ESM jest cannot reliably jest.mock axios, so the client takes an
// injectable AxiosInstance for testing. The test mocks the `get`
// method directly and confirms call shapes plus 200/404/error
// handling.
//
// ESM jest also drops the implicit `jest` global — the `jest` factory
// needs an explicit `@jest/globals` import for jest.fn() etc.

interface FakeAxios {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  post?: any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFakeAxios(impl: FakeAxios | any): AxiosInstance {
  if (typeof impl === 'function') {
    // Back-compat for existing call sites that pass just a get mock.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { get: impl } as any;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return impl as any;
}

describe('InternalControlPlaneClient', () => {
  describe('listActiveReferencesForOrg', () => {
    it('GETs /consent/connection-references/active with the orgId param and returns the items array', async () => {
      const items = [
        { id: 'ref-1', orgId: 'org-test' },
        { id: 'ref-2', orgId: 'org-test' },
      ];
      const getMock = // eslint-disable-next-line @typescript-eslint/no-explicit-any
(jest.fn() as any).mockResolvedValue({ status: 200, data: { items } });
      const client = new InternalControlPlaneClient(makeFakeAxios(getMock));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await client.listActiveReferencesForOrg('org-test')) as any[];

      expect(getMock).toHaveBeenCalledWith(
        '/consent/connection-references/active',
        { params: { orgId: 'org-test' } },
      );
      expect(result).toEqual(items);
    });
  });

  describe('lookupActiveReference', () => {
    it('returns the reference body on 200', async () => {
      const ref = { id: 'ref-1', orgId: 'org-test' };
      const getMock = // eslint-disable-next-line @typescript-eslint/no-explicit-any
(jest.fn() as any).mockResolvedValue({ status: 200, data: ref });
      const client = new InternalControlPlaneClient(makeFakeAxios(getMock));

      const result = await client.lookupActiveReference('org-test', 'agent-1', 'product-1');

      expect(getMock).toHaveBeenCalledWith(
        '/consent/connection-references/active/lookup',
        { params: { orgId: 'org-test', agentId: 'agent-1', productId: 'product-1' } },
      );
      expect(result).toEqual(ref);
    });

    it('returns null on 404 (the API says no active reference for the triple)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const getMock = (jest.fn() as any).mockResolvedValue({
        status: 404,
        data: { message: 'not found' },
      });
      const client = new InternalControlPlaneClient(makeFakeAxios(getMock));

      const result = await client.lookupActiveReference('org-test', 'agent-1', 'product-1');

      expect(result).toBeNull();
    });

    it('re-throws on network / 401 / 500 — caller must distinguish unreachable from absent', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const getMock = (jest.fn() as any).mockRejectedValue(new Error('ECONNREFUSED'));
      const client = new InternalControlPlaneClient(makeFakeAxios(getMock));

      await expect(
        client.lookupActiveReference('org-test', 'agent-1', 'product-1'),
      ).rejects.toThrow('ECONNREFUSED');
    });
  });

  describe('lookupActiveAccessGrant', () => {
    it('GETs /access/grants/active/lookup with the triple params and returns the grant on 200', async () => {
      const grant = { id: 'grant-1', orgId: 'org-test', productId: 'product-1' };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const getMock = (jest.fn() as any).mockResolvedValue({ status: 200, data: grant });
      const client = new InternalControlPlaneClient(makeFakeAxios(getMock));

      const result = await client.lookupActiveAccessGrant('org-test', 'agent-1', 'product-1');

      expect(getMock).toHaveBeenCalledWith(
        '/access/grants/active/lookup',
        { params: { orgId: 'org-test', agentId: 'agent-1', productId: 'product-1' } },
      );
      expect(result).toEqual(grant);
    });

    it('returns null on 404 (the API says no active grant for the triple)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const getMock = (jest.fn() as any).mockResolvedValue({
        status: 404,
        data: { message: 'not found' },
      });
      const client = new InternalControlPlaneClient(makeFakeAxios(getMock));

      const result = await client.lookupActiveAccessGrant('org-test', 'agent-1', 'product-1');

      expect(result).toBeNull();
    });

    it('re-throws on network / 401 / 500', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const getMock = (jest.fn() as any).mockRejectedValue(new Error('ECONNREFUSED'));
      const client = new InternalControlPlaneClient(makeFakeAxios(getMock));

      await expect(
        client.lookupActiveAccessGrant('org-test', 'agent-1', 'product-1'),
      ).rejects.toThrow('ECONNREFUSED');
    });
  });

  describe('notifyScopeViolation', () => {
    const violationInput = {
      orgId: 'org-test',
      referenceId: 'ref-1',
      agentId: 'agent-1',
      productId: 'product-1',
      actionScope: { port: 'observability' },
      approvedScope: { ports: ['discovery'] },
      denyReason: 'not covered',
      enforcementMode: 'shadow' as const,
    };

    it('POSTs the violation payload to /consent/scope-violations with orgId as a query param', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const postMock = (jest.fn() as any).mockResolvedValue({ status: 204, data: '' });
      const client = new InternalControlPlaneClient(makeFakeAxios({ post: postMock }));

      await client.notifyScopeViolation(violationInput);

      expect(postMock).toHaveBeenCalledTimes(1);
      const [url, body, opts] = postMock.mock.calls[0];
      expect(url).toBe('/consent/scope-violations');
      expect(body).toMatchObject({
        referenceId: 'ref-1',
        agentId: 'agent-1',
        productId: 'product-1',
        actionScope: { port: 'observability' },
        approvedScope: { ports: ['discovery'] },
        enforcementMode: 'shadow',
      });
      expect(opts).toEqual({ params: { orgId: 'org-test' } });
    });

    it('swallows errors — audit row is the durable record, not this call', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const postMock = (jest.fn() as any).mockRejectedValue(new Error('api down'));
      const client = new InternalControlPlaneClient(makeFakeAxios({ post: postMock }));

      await expect(client.notifyScopeViolation(violationInput)).resolves.toBeUndefined();
    });
  });
});
