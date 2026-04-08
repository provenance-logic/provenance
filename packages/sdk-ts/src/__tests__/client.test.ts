import { LineageClient } from '../client';
import type { LineageEvent, LineageClientConfig } from '../types';
import { sourceNode, dataProductNode, derivesFrom } from '../builders';

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

function ok202() {
  return Promise.resolve({ status: 202, text: () => Promise.resolve('') });
}

function fail500() {
  return Promise.resolve({ status: 500, text: () => Promise.resolve('Internal Server Error') });
}

function makeConfig(overrides?: Partial<LineageClientConfig>): LineageClientConfig {
  return {
    baseUrl: 'http://localhost:3001',
    orgId: 'test-org',
    token: 'test-token',
    flushIntervalMs: 60000, // long interval so auto-flush doesn't interfere
    ...overrides,
  };
}

function makeEvent(id = 'src-1'): LineageEvent {
  return derivesFrom(
    sourceNode(id, 'test-org', 'Test Source'),
    dataProductNode('prod-1', 'test-org', 'Test Product'),
  );
}

afterEach(() => {
  mockFetch.mockReset();
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Buffer management
// ---------------------------------------------------------------------------

describe('buffer management', () => {
  test('emit() adds event to buffer and flush() sends it', async () => {
    mockFetch.mockImplementation(ok202);
    const client = new LineageClient(makeConfig());

    client.emit(makeEvent());
    await client.flush();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:3001/api/v1/organizations/test-org/lineage/events/batch');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Authorization']).toBe('Bearer test-token');

    const body = JSON.parse(opts.body);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].source_node.node_id).toBe('src-1');

    await client.close();
  });

  test('emit() triggers immediate flush when buffer reaches batchSize', async () => {
    mockFetch.mockImplementation(ok202);
    const client = new LineageClient(makeConfig({ batchSize: 3 }));

    client.emit(makeEvent('a'));
    client.emit(makeEvent('b'));
    expect(mockFetch).not.toHaveBeenCalled();

    client.emit(makeEvent('c'));
    // Wait for the fire-and-forget flush
    await new Promise((r) => setTimeout(r, 50));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.events).toHaveLength(3);

    await client.close();
  });

  test('flush() sends buffer in correct chunk sizes', async () => {
    mockFetch.mockImplementation(ok202);
    const client = new LineageClient(makeConfig({ batchSize: 2 }));

    client.emit(makeEvent('a'));
    client.emit(makeEvent('b'));
    client.emit(makeEvent('c'));
    await client.flush();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const batch1 = JSON.parse(mockFetch.mock.calls[0][1].body);
    const batch2 = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(batch1.events).toHaveLength(2);
    expect(batch2.events).toHaveLength(1);

    await client.close();
  });

  test('flush() clears buffer after successful send', async () => {
    mockFetch.mockImplementation(ok202);
    const client = new LineageClient(makeConfig());

    client.emit(makeEvent());
    await client.flush();
    mockFetch.mockClear();

    await client.flush(); // second flush should be a no-op
    expect(mockFetch).not.toHaveBeenCalled();

    await client.close();
  });

  test('flush() retains buffer on failure', async () => {
    mockFetch.mockImplementation(fail500);
    const errors: any[] = [];
    const client = new LineageClient(
      makeConfig({ maxRetries: 0, onError: (e) => errors.push(e) }),
    );

    client.emit(makeEvent());
    await client.flush();
    expect(errors).toHaveLength(1);

    // Event should still be in buffer since send failed — retry succeeds
    mockFetch.mockReset();
    mockFetch.mockImplementation(ok202);
    await client.flush();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.events).toHaveLength(1);

    await client.close();
  });

  test('concurrent flush() calls do not double-send', async () => {
    let resolveFirst: () => void;
    const firstCall = new Promise<void>((r) => { resolveFirst = r; });
    mockFetch.mockImplementationOnce(() =>
      firstCall.then(() => ({ status: 202, text: () => Promise.resolve('') })),
    );
    mockFetch.mockImplementation(ok202);

    const client = new LineageClient(makeConfig());
    client.emit(makeEvent());

    const flush1 = client.flush();
    const flush2 = client.flush();

    resolveFirst!();
    await Promise.all([flush1, flush2]);

    expect(mockFetch).toHaveBeenCalledTimes(1);

    await client.close();
  });

  test('close() flushes remaining events', async () => {
    mockFetch.mockImplementation(ok202);
    const client = new LineageClient(makeConfig());

    client.emit(makeEvent());
    await client.close();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('emit() after close() throws', async () => {
    mockFetch.mockImplementation(ok202);
    const client = new LineageClient(makeConfig());
    await client.close();

    expect(() => client.emit(makeEvent())).toThrow('LineageClient is closed');
  });
});

// ---------------------------------------------------------------------------
// Retry behavior
// ---------------------------------------------------------------------------

describe('retry behavior', () => {
  test('emitNow() retries up to maxRetries on non-202', async () => {
    mockFetch
      .mockImplementationOnce(fail500)
      .mockImplementationOnce(fail500)
      .mockImplementationOnce(fail500)
      .mockImplementationOnce(ok202);

    const client = new LineageClient(makeConfig({ maxRetries: 3, retryBaseDelayMs: 10 }));
    await client.emitNow(makeEvent());

    expect(mockFetch).toHaveBeenCalledTimes(4); // 1 initial + 3 retries

    await client.close();
  });

  test('delay sequence is correct: base * 2^attempt', async () => {
    const delays: number[] = [];
    const origSetTimeout = global.setTimeout;
    jest.spyOn(global, 'setTimeout').mockImplementation((fn: any, ms?: number) => {
      delays.push(ms ?? 0);
      return origSetTimeout(fn, 0); // execute immediately for test speed
    });

    mockFetch.mockImplementation(fail500);
    const errors: any[] = [];
    const client = new LineageClient(
      makeConfig({ maxRetries: 3, retryBaseDelayMs: 200, onError: (e) => errors.push(e) }),
    );

    await client.emitNow(makeEvent());

    // Filter out non-retry timeouts (intervals, etc.)
    const retryDelays = delays.filter((d) => d >= 200);
    expect(retryDelays).toEqual([200, 400, 800]);

    await client.close();
  });

  test('onError is called on final failure if provided', async () => {
    mockFetch.mockImplementation(fail500);
    const errors: any[] = [];
    const client = new LineageClient(
      makeConfig({ maxRetries: 1, retryBaseDelayMs: 10, onError: (e) => errors.push(e) }),
    );

    await client.emitNow(makeEvent());

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('500');
    expect(errors[0].attempt).toBe(1);
    expect(errors[0].statusCode).toBe(500);

    await client.close();
  });

  test('re-throws on final failure if no onError', async () => {
    mockFetch.mockImplementation(fail500);
    const client = new LineageClient(makeConfig({ maxRetries: 0 }));

    await expect(client.emitNow(makeEvent())).rejects.toThrow('500');

    await client.close();
  });

  test('202 does not trigger retry', async () => {
    mockFetch.mockImplementation(ok202);
    const client = new LineageClient(makeConfig());

    await client.emitNow(makeEvent());
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await client.close();
  });
});

// ---------------------------------------------------------------------------
// Request shape
// ---------------------------------------------------------------------------

describe('request shape', () => {
  test('emitNow() sends to correct single-event URL', async () => {
    mockFetch.mockImplementation(ok202);
    const client = new LineageClient(makeConfig());

    await client.emitNow(makeEvent());

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:3001/api/v1/organizations/test-org/lineage/events');

    await client.close();
  });

  test('flush() sends to correct batch URL wrapped in { events: [] }', async () => {
    mockFetch.mockImplementation(ok202);
    const client = new LineageClient(makeConfig());

    client.emit(makeEvent());
    await client.flush();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/lineage/events/batch');
    const body = JSON.parse(opts.body);
    expect(body).toHaveProperty('events');
    expect(Array.isArray(body.events)).toBe(true);

    await client.close();
  });

  test('Authorization header is Bearer <token>', async () => {
    mockFetch.mockImplementation(ok202);
    const client = new LineageClient(makeConfig({ token: 'my-secret-token' }));

    await client.emitNow(makeEvent());
    expect(mockFetch.mock.calls[0][1].headers['Authorization']).toBe('Bearer my-secret-token');

    await client.close();
  });

  test('emitted_at defaults to ISO timestamp if not provided', async () => {
    mockFetch.mockImplementation(ok202);
    const client = new LineageClient(makeConfig());

    const event = makeEvent();
    delete event.emitted_at;
    await client.emitNow(event);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.emitted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    await client.close();
  });

  test('emitted_by defaults to config.defaultEmittedBy if not on event', async () => {
    mockFetch.mockImplementation(ok202);
    const client = new LineageClient(makeConfig({ defaultEmittedBy: 'sdk-test' }));

    const event = makeEvent();
    delete event.emitted_by;
    await client.emitNow(event);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.emitted_by).toBe('sdk-test');

    await client.close();
  });
});

// ---------------------------------------------------------------------------
// Constructor validation
// ---------------------------------------------------------------------------

describe('constructor validation', () => {
  test('throws if baseUrl is missing', () => {
    expect(() => new LineageClient({ baseUrl: '', orgId: 'x', token: 'x' })).toThrow();
  });

  test('throws if orgId is missing', () => {
    expect(() => new LineageClient({ baseUrl: 'http://x', orgId: '', token: 'x' })).toThrow();
  });

  test('throws if token is missing', () => {
    expect(() => new LineageClient({ baseUrl: 'http://x', orgId: 'x', token: '' })).toThrow();
  });
});
