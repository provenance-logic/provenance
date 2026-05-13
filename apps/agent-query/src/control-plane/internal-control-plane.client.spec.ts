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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFakeAxios(getImpl: any): AxiosInstance {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { get: getImpl } as any;
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
      const getMock = // eslint-disable-next-line @typescript-eslint/no-explicit-any
(jest.fn() as any).mockRejectedValue(new Error('ECONNREFUSED'));
      const client = new InternalControlPlaneClient(makeFakeAxios(getMock));

      await expect(
        client.lookupActiveReference('org-test', 'agent-1', 'product-1'),
      ).rejects.toThrow('ECONNREFUSED');
    });
  });
});
