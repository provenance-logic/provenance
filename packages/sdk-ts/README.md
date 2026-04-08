# @provenance/sdk-ts

Provenance Lineage TypeScript SDK — a zero-dependency client for emitting lineage events to the Provenance platform.

## Quick Start

```typescript
import {
  LineageClient,
  sourceNode,
  dataProductNode,
  derivesFrom,
} from '@provenance/sdk-ts';

const client = new LineageClient({
  baseUrl: 'http://localhost:3001',
  orgId: 'your-org-id',
  token: 'your-token',
});

const raw = sourceNode('pg-orders', 'your-org-id', 'Orders DB');
const product = dataProductNode('uuid-here', 'your-org-id', 'Order Analytics');

// Fire-and-forget (batched automatically)
client.emit(derivesFrom(raw, product));

// Or await a single event
await client.emitNow(derivesFrom(raw, product));

// Always close when done to flush remaining events
await client.close();
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseUrl` | `string` | *required* | Provenance API base URL |
| `orgId` | `string` | *required* | Organization ID |
| `token` | `string` | *required* | Bearer token for authentication |
| `defaultEmittedBy` | `string` | `undefined` | Default value for `emitted_by` on events |
| `batchSize` | `number` | `100` | Events per batch (max 500) |
| `flushIntervalMs` | `number` | `5000` | Auto-flush interval in milliseconds |
| `maxRetries` | `number` | `3` | Max retry attempts on failure |
| `retryBaseDelayMs` | `number` | `200` | Base delay for exponential backoff |
| `onError` | `function` | `undefined` | Error callback; if unset, errors are thrown |

## Node Builders

| Function | Node Type | Arguments |
|----------|-----------|-----------|
| `sourceNode(id, orgId, displayName, metadata?)` | Source | External data source |
| `dataProductNode(id, orgId, displayName, metadata?)` | DataProduct | Published data product |
| `portNode(id, orgId, displayName, metadata?)` | Port | Input/output port |
| `transformationNode(id, orgId, displayName, logic?, metadata?)` | Transformation | ETL step; `logic` saved to metadata |
| `agentNode(id, orgId, displayName, metadata?)` | Agent | AI agent |
| `consumerNode(id, orgId, displayName, metadata?)` | Consumer | Data consumer |

## Edge Builders

| Function | Edge Type | Description |
|----------|-----------|-------------|
| `derivesFrom(source, target, opts?)` | DERIVES_FROM | Target derives from source |
| `transforms(source, target, logic, opts?)` | TRANSFORMS | Source transforms into target |
| `consumes(consumer, product, opts?)` | CONSUMES | Consumer reads from product |
| `dependsOn(product, dependency, opts?)` | DEPENDS_ON | Product depends on dependency |
| `supersedes(newProduct, oldProduct, opts?)` | SUPERSEDES | New product replaces old |

## Error Handling

By default, `emitNow()` and `flush()` throw on final failure after retries.
Set `onError` in the config to handle errors without throwing:

```typescript
const client = new LineageClient({
  baseUrl: 'http://localhost:3001',
  orgId: 'org-id',
  token: 'token',
  onError: (err) => {
    console.error(`Failed to emit ${err.events.length} events: ${err.message}`);
  },
});
```

## Zero Runtime Dependencies

This SDK uses only the native `fetch()` API (Node.js 18+). No axios, node-fetch, or other HTTP libraries are required.
