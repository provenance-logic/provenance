import { Test } from '@nestjs/testing';
import { OpaClient, OPA_BASE_URL } from '../opa/opa-client.js';

const BASE_URL = 'http://localhost:8181';

describe('OpaClient', () => {
  let client: OpaClient;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        OpaClient,
        { provide: OPA_BASE_URL, useValue: BASE_URL },
      ],
    }).compile();

    client = module.get(OpaClient);

    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // upsertPolicy
  // ---------------------------------------------------------------------------

  describe('upsertPolicy()', () => {
    it('sends PUT to the correct OPA policies URL with the Rego text', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('', { status: 200 }));

      await client.upsertPolicy('my_policy_id', 'package foo\nallow := true');

      expect(fetchSpy).toHaveBeenCalledWith(
        `${BASE_URL}/v1/policies/my_policy_id`,
        expect.objectContaining({
          method: 'PUT',
          headers: { 'Content-Type': 'text/plain' },
          body: 'package foo\nallow := true',
        }),
      );
    });

    it('resolves without error on 200 OK', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));
      await expect(client.upsertPolicy('pid', 'package foo')).resolves.toBeUndefined();
    });

    it('throws an error when OPA returns a non-2xx status', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('parse error on line 1', { status: 400 }),
      );

      await expect(client.upsertPolicy('pid', 'bad rego')).rejects.toThrow(
        /OPA policy upload failed \[400\]/,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // evaluate
  // ---------------------------------------------------------------------------

  describe('evaluate()', () => {
    it('sends POST to the correct OPA data path with input wrapped in { input: ... }', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ result: [] }), { status: 200 }),
      );
      const input = { product: { id: 'p-1', ports: [] } };

      await client.evaluate('provenance/governance/product_schema/org_abc/violations', input);

      expect(fetchSpy).toHaveBeenCalledWith(
        `${BASE_URL}/v1/data/provenance/governance/product_schema/org_abc/violations`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input }),
        }),
      );
    });

    it('returns the result value from the OPA response', async () => {
      const violations = [
        { rule_id: 'require_output_port', detail: 'missing port', policyDomain: 'product_schema' },
      ];
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ result: violations }), { status: 200 }),
      );

      const result = await client.evaluate<typeof violations>(
        'provenance/governance/product_schema/org_abc/violations',
        {},
      );

      expect(result).toEqual(violations);
    });

    it('returns undefined when OPA response has no result key (path undefined)', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 }),
      );

      const result = await client.evaluate('some/undefined/path', {});
      expect(result).toBeUndefined();
    });

    it('throws an error when OPA returns a non-2xx status', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('internal server error', { status: 500 }),
      );

      await expect(
        client.evaluate('provenance/governance/product_schema/org_abc/violations', {}),
      ).rejects.toThrow(/OPA evaluation failed \[500\]/);
    });
  });

  // ---------------------------------------------------------------------------
  // deletePolicy
  // ---------------------------------------------------------------------------

  describe('deletePolicy()', () => {
    it('sends DELETE to the correct OPA policies URL', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('', { status: 200 }));

      await client.deletePolicy('my_policy_id');

      expect(fetchSpy).toHaveBeenCalledWith(
        `${BASE_URL}/v1/policies/my_policy_id`,
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('resolves without error on 200 OK', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('', { status: 200 }));
      await expect(client.deletePolicy('pid')).resolves.toBeUndefined();
    });

    it('silently ignores 404 Not Found', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('not found', { status: 404 }));
      await expect(client.deletePolicy('non_existent')).resolves.toBeUndefined();
    });

    it('throws an error for non-404 failures', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('server error', { status: 500 }));
      await expect(client.deletePolicy('pid')).rejects.toThrow(
        /OPA policy delete failed \[500\]/,
      );
    });
  });
});
