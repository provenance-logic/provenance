import { Injectable, Inject } from '@nestjs/common';

export const OPA_BASE_URL = 'OPA_BASE_URL';

/**
 * HTTP client for the OPA REST API.
 * OPA is deployed as a sidecar and reached at OPA_BASE_URL (default http://opa:8181).
 *
 * Relevant OPA endpoints:
 *   PUT  /v1/policies/{id}   — upload or replace a named Rego module
 *   POST /v1/data/{path}     — evaluate data/rules at the given path
 *   DELETE /v1/policies/{id} — remove a named policy module
 */
@Injectable()
export class OpaClient {
  constructor(@Inject(OPA_BASE_URL) private readonly baseUrl: string) {}

  /**
   * Upload or replace a named Rego policy module in OPA.
   * The policyId must be URL-safe (use underscores, not hyphens or slashes).
   */
  async upsertPolicy(policyId: string, regoText: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/v1/policies/${policyId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: regoText,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OPA policy upload failed [${res.status}]: ${body}`);
    }
  }

  /**
   * Evaluate a data path in OPA and return the result.
   * Input is passed as { "input": <value> } per the OPA data API spec.
   *
   * @param dataPath - OPA data path without leading slash
   *   e.g. "provenance/governance/product_schema/org_abc123/violations"
   * @param input    - Input document evaluated against the Rego rules
   * @returns The result value, or undefined if the path yields no data
   */
  async evaluate<T>(dataPath: string, input: unknown): Promise<T | undefined> {
    const res = await fetch(`${this.baseUrl}/v1/data/${dataPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OPA evaluation failed [${res.status}]: ${body}`);
    }
    const json = (await res.json()) as { result?: T };
    return json.result;
  }

  /**
   * Delete a named policy module from OPA.
   * Safe to call on non-existent policies (404 is silently ignored).
   */
  async deletePolicy(policyId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/v1/policies/${policyId}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 404) {
      const body = await res.text();
      throw new Error(`OPA policy delete failed [${res.status}]: ${body}`);
    }
  }
}
