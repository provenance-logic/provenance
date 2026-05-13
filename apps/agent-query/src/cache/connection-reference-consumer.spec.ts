import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ConnectionReferenceConsumer } from './connection-reference-consumer.js';
import type { ConnectionReferenceCache } from './connection-reference-cache.js';
import type { InternalControlPlaneClient } from '../control-plane/internal-control-plane.client.js';
import type { ConnectionReference } from '@provenance/types';

// Consumer dispatch tests. We do not test kafkajs itself — we drive
// the consumer's `handleMessage` path directly with fake EachMessage
// payloads. Cache and control-plane client are mocked; the test
// surface is the routing logic that ADR-007 § "Consumer behavior"
// defines.

function makeReference(overrides: Partial<ConnectionReference> = {}): ConnectionReference {
  return {
    id: 'ref-1',
    orgId: 'org-1',
    agentId: 'agent-1',
    productId: 'product-1',
    productVersionId: null,
    accessGrantId: 'grant-1',
    owningPrincipalId: 'owner-1',
    state: 'active',
    causedBy: 'principal_action',
    requestedAt: '2026-05-13T00:00:00.000Z',
    approvedAt: '2026-05-13T00:00:00.000Z',
    activatedAt: '2026-05-13T00:00:00.000Z',
    suspendedAt: null,
    expiresAt: '2026-06-13T00:00:00.000Z',
    terminatedAt: null,
    approvedByPrincipalId: 'owner-1',
    governancePolicyVersion: null,
    useCaseCategory: 'Reporting and Analytics',
    purposeElaboration: 'x'.repeat(60),
    intendedScope: { ports: ['discovery'] },
    dataCategoryConstraints: null,
    requestedDurationDays: 30,
    approvedScope: { ports: ['discovery'] },
    approvedDataCategoryConstraints: null,
    approvedDurationDays: 30,
    modifiedByApprover: false,
    denialReason: null,
    deniedByPrincipalId: null,
    connectionPackage: null,
    createdAt: '2026-05-13T00:00:00.000Z',
    updatedAt: '2026-05-13T00:00:00.000Z',
    ...overrides,
  };
}

function makeEventPayload(overrides: Partial<{
  connectionReferenceId: string;
  orgId: string;
  agentId: string;
  productId: string;
  newState: string;
  previousState: string | null;
}>): { value: Buffer } {
  return {
    value: Buffer.from(
      JSON.stringify({
        connectionReferenceId: 'ref-1',
        orgId: 'org-1',
        agentId: 'agent-1',
        productId: 'product-1',
        newState: 'active',
        previousState: 'pending',
        scope: { ports: ['discovery'] },
        useCaseCategory: 'Reporting and Analytics',
        transitionedAt: '2026-05-13T00:00:00.000Z',
        causedBy: 'principal_action',
        ...overrides,
      }),
    ),
  };
}

describe('ConnectionReferenceConsumer.handleMessage', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cache: { set: any; invalidate: any };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let controlPlane: { lookupActiveReference: any };
  let consumer: ConnectionReferenceConsumer;

  beforeEach(() => {
    cache = {
      set: jest.fn(),
      invalidate: jest.fn(),
    };
    controlPlane = {
      lookupActiveReference: jest.fn(),
    };
    // Construct with empty brokers so the internal Kafka client is
    // instantiated but never connects — handleMessage drives the
    // dispatch directly.
    consumer = new ConnectionReferenceConsumer(
      [],
      cache as unknown as ConnectionReferenceCache,
      controlPlane as unknown as InternalControlPlaneClient,
    );
  });

  it('on Active event, fetches the full reference and caches it', async () => {
    const ref = makeReference();
    controlPlane.lookupActiveReference.mockResolvedValue(ref);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await consumer.handleMessage({ message: makeEventPayload({ newState: 'active' }) } as any);

    expect(controlPlane.lookupActiveReference).toHaveBeenCalledWith(
      'org-1',
      'agent-1',
      'product-1',
    );
    expect(cache.set).toHaveBeenCalledWith('org-1', 'agent-1', 'product-1', ref);
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('on Active event when lookup returns null, defensively invalidates the cache entry', async () => {
    controlPlane.lookupActiveReference.mockResolvedValue(null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await consumer.handleMessage({ message: makeEventPayload({ newState: 'active' }) } as any);

    expect(cache.set).not.toHaveBeenCalled();
    expect(cache.invalidate).toHaveBeenCalledWith('org-1', 'agent-1', 'product-1');
  });

  it.each(['suspended', 'expired', 'revoked'])(
    'on %s event, invalidates without fetching',
    async (newState) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await consumer.handleMessage({ message: makeEventPayload({ newState }) } as any);

      expect(controlPlane.lookupActiveReference).not.toHaveBeenCalled();
      expect(cache.invalidate).toHaveBeenCalledWith('org-1', 'agent-1', 'product-1');
      expect(cache.set).not.toHaveBeenCalled();
    },
  );

  it('on Pending event, no-op — neither cache method is called', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await consumer.handleMessage({ message: makeEventPayload({ newState: 'pending' }) } as any);

    expect(cache.set).not.toHaveBeenCalled();
    expect(cache.invalidate).not.toHaveBeenCalled();
    expect(controlPlane.lookupActiveReference).not.toHaveBeenCalled();
  });

  it('on an unparseable message, logs a warning and does not throw', async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      consumer.handleMessage({ message: { value: Buffer.from('not-json') } } as any),
    ).resolves.toBeUndefined();
    expect(cache.set).not.toHaveBeenCalled();
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('on a message with no value, returns without error', async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      consumer.handleMessage({ message: { value: null } } as any),
    ).resolves.toBeUndefined();
    expect(cache.set).not.toHaveBeenCalled();
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('re-throws when the lookup call itself fails so kafkajs retries', async () => {
    controlPlane.lookupActiveReference.mockRejectedValue(new Error('network down'));

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      consumer.handleMessage({ message: makeEventPayload({ newState: 'active' }) } as any),
    ).rejects.toThrow('network down');
  });
});
