import type { LineageClientConfig, LineageEvent, EmissionError } from './types.js';

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 200;

export class LineageClient {
  private readonly config: Required<
    Pick<LineageClientConfig, 'baseUrl' | 'orgId' | 'token' | 'maxRetries' | 'retryBaseDelayMs'>
  > & LineageClientConfig;

  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private buffer: LineageEvent[] = [];
  private _flushPromise: Promise<void> | null = null;
  private _closed = false;
  private _timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: LineageClientConfig) {
    if (!config.baseUrl || !config.orgId || !config.token) {
      throw new Error('LineageClient requires baseUrl, orgId, and token');
    }

    this.config = {
      ...config,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      retryBaseDelayMs: config.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
    };

    this.batchSize = Math.min(config.batchSize ?? DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE);
    this.flushIntervalMs = config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;

    this._timer = setInterval(() => {
      if (this.buffer.length > 0) {
        this.flush().catch(() => {});
      }
    }, this.flushIntervalMs);
  }

  emit(event: LineageEvent): void {
    if (this._closed) {
      throw new Error('LineageClient is closed');
    }

    const prepared = this._prepare(event);
    this.buffer.push(prepared);

    if (this.buffer.length >= this.batchSize) {
      this.flush().catch(() => {});
    }
  }

  async emitNow(event: LineageEvent): Promise<void> {
    if (this._closed) {
      throw new Error('LineageClient is closed');
    }

    const prepared = this._prepare(event);
    try {
      await this._withRetry([prepared], () => this._sendSingle(prepared));
    } catch (err: unknown) {
      if (this.config.onError) {
        const message = err instanceof Error ? err.message : String(err);
        const statusCode = (err as Error & { statusCode?: number }).statusCode;
        this.config.onError({
          message,
          events: [prepared],
          statusCode,
          attempt: this.config.maxRetries,
        });
      } else {
        throw err;
      }
    }
  }

  async flush(): Promise<void> {
    if (this._flushPromise) {
      return this._flushPromise;
    }

    this._flushPromise = this._doFlush();
    try {
      await this._flushPromise;
    } finally {
      this._flushPromise = null;
    }
  }

  async close(): Promise<void> {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._closed = true;
    await this.flush();
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private _prepare(event: LineageEvent): LineageEvent {
    return {
      ...event,
      emitted_at: event.emitted_at ?? new Date().toISOString(),
      emitted_by: event.emitted_by ?? this.config.defaultEmittedBy,
    };
  }

  private async _doFlush(): Promise<void> {
    while (this.buffer.length > 0) {
      const chunk = this.buffer.splice(0, this.batchSize);
      try {
        await this._withRetry(chunk, () => this._sendBatch(chunk));
      } catch (err) {
        // Put unsent events back at the front of the buffer
        this.buffer.unshift(...chunk);
        // For flush(), report via onError but don't re-throw — the
        // events remain in the buffer for the next flush attempt.
        if (this.config.onError) {
          const message = err instanceof Error ? err.message : String(err);
          const statusCode = (err as Error & { statusCode?: number }).statusCode;
          this.config.onError({ message, events: chunk, statusCode, attempt: this.config.maxRetries });
        }
        return;
      }
    }
  }

  private async _withRetry(
    events: LineageEvent[],
    fn: () => Promise<void>,
  ): Promise<void> {
    let lastError: EmissionError | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        await fn();
        return;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const statusCode = (err as { statusCode?: number }).statusCode;
        lastError = { message, events, statusCode, attempt };

        if (attempt < this.config.maxRetries) {
          const delay = this.config.retryBaseDelayMs * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    if (lastError) {
      const err = new Error(lastError.message);
      (err as Error & { statusCode?: number }).statusCode = lastError.statusCode;
      throw err;
    }
  }

  private async _sendSingle(event: LineageEvent): Promise<void> {
    const url = `${this.config.baseUrl}/api/v1/organizations/${this.config.orgId}/lineage/events`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.token}`,
      },
      body: JSON.stringify(event),
    });

    if (res.status !== 202) {
      const body = await res.text();
      const err = new Error(`HTTP ${res.status}: ${body}`);
      (err as Error & { statusCode?: number }).statusCode = res.status;
      throw err;
    }
  }

  private async _sendBatch(events: LineageEvent[]): Promise<void> {
    const url = `${this.config.baseUrl}/api/v1/organizations/${this.config.orgId}/lineage/events/batch`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.token}`,
      },
      body: JSON.stringify({ events }),
    });

    if (res.status !== 202) {
      const body = await res.text();
      const err = new Error(`HTTP ${res.status}: ${body}`);
      (err as Error & { statusCode?: number }).statusCode = res.status;
      throw err;
    }
  }
}
