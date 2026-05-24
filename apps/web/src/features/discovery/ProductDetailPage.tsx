import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  marketplaceApi,
  SNIPPET_DESTINATIONS,
  type SnippetDestination,
  type PortSnippetResponse,
} from '../../shared/api/marketplace.js';
import { accessApi } from '../../shared/api/access.js';
import type { PortSituationResponse } from '@provenance/types';
import { ApiError } from '../../shared/api/client.js';
import { useAuth } from '../../auth/AuthProvider.js';
import { AccessRequestSlideOver } from './AccessRequestSlideOver.js';
import { LineageExplorer } from '../lineage/LineageExplorer.js';
import { TrustScorePanel } from '../trust-score/TrustScorePanel.js';
import { ObservabilityDashboard } from '../observability/ObservabilityDashboard.js';
import type {
  MarketplaceProductDetail,
  ProductSchema,
  Port,
  AccessRequest,
  DataClassification,
  ComplianceStateValue,
  OutputPortInterfaceType,
  ProductAccessStatusValue,
} from '@provenance/types';

// ---------------------------------------------------------------------------
// Per-interface consumption guidance — surfaced on each output port so a
// consumer can go from "I see this product" to "I am querying this product"
// without leaving the platform. Patterns are illustrative defaults; real
// connection details are the port owner's responsibility to fill in.
// ---------------------------------------------------------------------------

// CONSUMPTION_GUIDANCE was a static per-interface-type placeholder template
// that rendered literal `<host>` / `<base-url>` placeholders on every product
// detail page. It was the inverted-UX side of B-069. Replaced by the
// `SnippetPicker` component below, which lets the consumer pick their tool
// and fetches a real snippet from `GET .../ports/:portId/snippet?destination=`.

// ---------------------------------------------------------------------------
// Style maps
// ---------------------------------------------------------------------------

const CLASSIFICATION_STYLES: Record<DataClassification, string> = {
  public:       'bg-blue-100 text-blue-800',
  internal:     'bg-slate-100 text-slate-700',
  confidential: 'bg-amber-100 text-amber-800',
  restricted:   'bg-red-100 text-red-800',
};

const COMPLIANCE_BADGE: Record<ComplianceStateValue, string> = {
  compliant:      'bg-green-100 text-green-800 border-green-200',
  drift_detected: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  grace_period:   'bg-orange-100 text-orange-800 border-orange-200',
  non_compliant:  'bg-red-100 text-red-800 border-red-200',
};

const COMPLIANCE_LABEL: Record<ComplianceStateValue, string> = {
  compliant:      'Compliant',
  drift_detected: 'Drift Detected',
  grace_period:   'Grace Period',
  non_compliant:  'Non-Compliant',
};

const STATUS_STYLES: Record<string, string> = {
  published:      'bg-green-100 text-green-800',
  deprecated:     'bg-orange-100 text-orange-800',
  draft:          'bg-yellow-100 text-yellow-800',
  decommissioned: 'bg-red-100 text-red-800',
};

const INTERFACE_LABELS: Record<OutputPortInterfaceType, string> = {
  sql_jdbc:                'SQL / JDBC',
  rest_api:                'REST API',
  graphql:                 'GraphQL',
  streaming_topic:         'Streaming Topic',
  file_object_export:      'File / Object',
  semantic_query_endpoint: 'Semantic Query (Agents)',
};

const INTERFACE_COLORS: Record<OutputPortInterfaceType, string> = {
  sql_jdbc:                'bg-blue-100 text-blue-700',
  rest_api:                'bg-green-100 text-green-700',
  graphql:                 'bg-purple-100 text-purple-700',
  streaming_topic:         'bg-orange-100 text-orange-700',
  file_object_export:      'bg-slate-100 text-slate-700',
  semantic_query_endpoint: 'bg-indigo-100 text-indigo-700',
};

type TabId = 'overview' | 'schema' | 'ports' | 'lineage' | 'slos' | 'access';
const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'schema',   label: 'Schema'   },
  { id: 'ports',    label: 'Ports'    },
  { id: 'lineage',  label: 'Lineage'  },
  { id: 'slos',     label: 'SLOs'     },
  { id: 'access',   label: 'Access'   },
];

// ---------------------------------------------------------------------------
// Tab contents
// ---------------------------------------------------------------------------

function OverviewTab({ product }: { product: MarketplaceProductDetail }) {
  const ownerLine = product.owner
    ? (product.owner.displayName ?? product.owner.email ?? product.owner.id)
    : null;
  const domainTeamOwner = product.domainTeam?.ownerDisplayName ?? product.domainTeam?.ownerEmail ?? null;

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Description</h3>
        <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">
          {product.description ?? 'No description provided.'}
        </p>
      </div>
      {product.tags.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Tags</h3>
          <div className="flex flex-wrap gap-2">
            {product.tags.map((tag) => (
              <span key={tag} className="px-2 py-1 bg-slate-100 text-slate-700 rounded text-xs">
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}
      {(product.owner || product.domainTeam) && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Ownership</h3>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {ownerLine && (
              <div>
                <dt className="text-slate-400 text-xs">Product owner</dt>
                <dd className="text-slate-700">{ownerLine}</dd>
                {product.owner?.email && product.owner.email !== ownerLine && (
                  <dd className="text-slate-500 text-xs">{product.owner.email}</dd>
                )}
              </div>
            )}
            {product.domainTeam && (
              <div>
                <dt className="text-slate-400 text-xs">Domain team</dt>
                <dd className="text-slate-700">{product.domainTeam.name}</dd>
                {domainTeamOwner && (
                  <dd className="text-slate-500 text-xs">Lead: {domainTeamOwner}</dd>
                )}
              </div>
            )}
          </dl>
        </div>
      )}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Details</h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-slate-400 text-xs">Classification</dt>
            <dd>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${CLASSIFICATION_STYLES[product.classification]}`}>
                {product.classification}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-slate-400 text-xs">Version</dt>
            <dd className="text-slate-700 font-mono">{product.version}</dd>
          </div>
          <div>
            <dt className="text-slate-400 text-xs">Domain</dt>
            <dd className="text-slate-700">{product.domainName}</dd>
          </div>
          <div>
            <dt className="text-slate-400 text-xs">Active consumers</dt>
            <dd className="text-slate-700">{product.activeConsumerCount}</dd>
          </div>
          <div>
            <dt className="text-slate-400 text-xs">Last updated</dt>
            <dd className="text-slate-700">{new Date(product.updatedAt).toLocaleDateString()}</dd>
          </div>
          <div>
            <dt className="text-slate-400 text-xs">Created</dt>
            <dd className="text-slate-700">{new Date(product.createdAt).toLocaleDateString()}</dd>
          </div>
        </dl>
      </div>
      {product.freshness && <FreshnessPanel freshness={product.freshness} />}
      {product.columnSchema && <ColumnSchemaPanel columnSchema={product.columnSchema} />}
    </div>
  );
}

function FreshnessPanel({ freshness }: { freshness: NonNullable<MarketplaceProductDetail['freshness']> }) {
  const lastRefreshedLabel = freshness.lastRefreshedAt
    ? new Date(freshness.lastRefreshedAt).toLocaleString()
    : 'Not yet observed';
  const statusCls = freshness.passed
    ? 'bg-green-50 text-green-700 border-green-200'
    : 'bg-red-50 text-red-700 border-red-200';
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">Freshness</h3>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <div>
          <dt className="text-slate-400 text-xs">Status</dt>
          <dd>
            <span className={`px-2 py-0.5 rounded text-xs font-medium border ${statusCls}`}>
              {freshness.passed ? 'Within SLO' : 'Stale'}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-slate-400 text-xs">SLO type</dt>
          <dd className="text-slate-700">{freshness.sloType}</dd>
        </div>
        <div>
          <dt className="text-slate-400 text-xs">Last refreshed</dt>
          <dd className="text-slate-700">{lastRefreshedLabel}</dd>
        </div>
        <div>
          <dt className="text-slate-400 text-xs">Last evaluated</dt>
          <dd className="text-slate-700">{new Date(freshness.evaluatedAt).toLocaleString()}</dd>
        </div>
        {freshness.measuredValue !== null && (
          <div className="col-span-2">
            <dt className="text-slate-400 text-xs">Measured value</dt>
            <dd className="text-slate-700 font-mono">{freshness.measuredValue}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function ColumnSchemaPanel({ columnSchema }: { columnSchema: NonNullable<MarketplaceProductDetail['columnSchema']> }) {
  const PREVIEW_LIMIT = 20;
  const previewColumns = columnSchema.columns.slice(0, PREVIEW_LIMIT);
  const remaining = columnSchema.columnCount - previewColumns.length;
  const capturedLabel = new Date(columnSchema.capturedAt).toLocaleString();

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700">Column schema</h3>
        <span className="text-xs text-slate-500">
          {columnSchema.columnCount} column{columnSchema.columnCount === 1 ? '' : 's'}
          {columnSchema.rowEstimate !== null && ` · ~${columnSchema.rowEstimate.toLocaleString()} rows`}
        </span>
      </div>
      {previewColumns.length === 0 ? (
        <p className="text-xs text-slate-500">No columns captured.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="font-medium pb-2 pr-4">Name</th>
                <th className="font-medium pb-2 pr-4">Type</th>
                <th className="font-medium pb-2">Nullable</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {previewColumns.map((col) => (
                <tr key={col.name} className="border-t border-slate-100">
                  <td className="py-1.5 pr-4 font-mono">{col.name}</td>
                  <td className="py-1.5 pr-4 font-mono">{col.type}</td>
                  <td className="py-1.5 text-slate-500">{col.nullable ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {remaining > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              + {remaining} more column{remaining === 1 ? '' : 's'} — see Schema tab for full contract.
            </p>
          )}
        </div>
      )}
      <p className="mt-3 text-xs text-slate-400">Captured {capturedLabel}</p>
    </div>
  );
}

function LifecycleBanner({ status }: { status: MarketplaceProductDetail['status'] }) {
  if (status === 'deprecated') {
    return (
      <div
        role="alert"
        className="mb-4 rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm"
      >
        <p className="font-semibold text-orange-900">This product is deprecated.</p>
        <p className="mt-1 text-orange-800">
          New consumers should not adopt it. Existing access remains valid until the
          product is decommissioned. Check the product owner for the recommended
          replacement.
        </p>
      </div>
    );
  }
  if (status === 'decommissioned') {
    return (
      <div
        role="alert"
        className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm"
      >
        <p className="font-semibold text-red-900">This product has been decommissioned.</p>
        <p className="mt-1 text-red-800">
          The data is no longer maintained or guaranteed available. Do not use it for
          new work. This page is kept for historical reference and audit.
        </p>
      </div>
    );
  }
  return null;
}

function FreshnessBadge({ product }: { product: MarketplaceProductDetail }) {
  if (!product.freshness) return null;
  const when = new Date(product.freshness.evaluatedAt).toLocaleDateString();
  const cls = product.freshness.passed
    ? 'bg-green-100 text-green-800 border-green-200'
    : 'bg-red-100 text-red-800 border-red-200';
  const label = product.freshness.passed ? 'Fresh' : 'Stale';
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium border ${cls}`}
      title={`Freshness SLO evaluated ${when}`}
    >
      {label}
    </span>
  );
}

function extractFieldsFromContract(contract: Record<string, unknown> | null | undefined): Array<{ name: string; type: string; description: string | null; required: boolean }> {
  if (!contract || typeof contract !== 'object') return [];
  const props = contract.properties;
  if (!props || typeof props !== 'object') return [];
  const requiredList = Array.isArray(contract.required)
    ? (contract.required as string[])
    : [];
  return Object.entries(props as Record<string, unknown>).map(([name, def]) => {
    const d = (def ?? {}) as { type?: string; description?: string };
    return {
      name,
      type: d.type ?? 'unknown',
      description: d.description ?? null,
      required: requiredList.includes(name),
    };
  });
}

function SchemaTab({ productId }: { productId: string }) {
  const [schema, setSchema] = useState<ProductSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);

  useEffect(() => {
    marketplaceApi.products.schemaGlobal(productId)
      .then((s) => { setSchema(s); setSelectedVersion(s.version); setLoading(false); })
      .catch((err) => { setError(err instanceof ApiError ? err.message : 'Failed to load schema'); setLoading(false); });
  }, [productId]);

  if (loading) return <LoadingState label="schema" />;
  if (error)   return <ErrorState message={error} />;
  if (!schema) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label htmlFor="schemaVersion" className="text-sm text-slate-600 font-medium">Schema version</label>
        <select
          id="schemaVersion"
          value={selectedVersion ?? schema.version}
          onChange={(e) => setSelectedVersion(e.target.value)}
          className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {schema.versionHistory.map((v) => (
            <option key={v.version} value={v.version}>
              v{v.version} — {v.changeDescription ?? 'No description'} ({new Date(v.createdAt).toLocaleDateString()})
            </option>
          ))}
        </select>
      </div>

      {schema.fields.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-5 text-sm text-slate-500">
          No schema fields declared. Add a JSON Schema contract to an output port to populate this view.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Field</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Type</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Nullable</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Description</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Annotation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {schema.fields.map((field) => (
                <tr key={field.name} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-900">{field.name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-brand-700">{field.type}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{field.nullable ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">{field.description ?? '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-400 italic">{field.semanticAnnotation ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Shows either full (granted) or redacted (not granted) connection details
 * per F10.6, falling back to nothing when neither field is set (unauth).
 */
function ConnectionDetailsPanel({ port }: { port: Port }) {
  if (port.connectionDetails) {
    return (
      <div className="border border-green-100 bg-green-50 rounded-lg p-3 mb-3">
        <p className="text-xs font-semibold text-green-800 mb-2">Connection details (granted access)</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {Object.entries(port.connectionDetails)
            .filter(([k]) => k !== 'kind')
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-slate-500 font-mono">{k}</dt>
                <dd className="text-slate-900 font-mono break-all">
                  {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                </dd>
              </div>
            ))}
        </dl>
      </div>
    );
  }
  if (port.connectionDetailsPreview) {
    const p = port.connectionDetailsPreview;
    return (
      <div className="border border-slate-200 bg-slate-50 rounded-lg p-3 mb-3">
        <p className="text-xs font-semibold text-slate-700 mb-1">
          Connection preview <span className="font-normal text-slate-500">(request access for full details)</span>
        </p>
        <dl className="text-xs space-y-0.5">
          {p.host && (
            <div className="flex gap-2"><dt className="text-slate-500 w-20">Host</dt><dd className="font-mono text-slate-800">{p.host}</dd></div>
          )}
          {p.endpoint && (
            <div className="flex gap-2"><dt className="text-slate-500 w-20">Endpoint</dt><dd className="font-mono text-slate-800">{p.endpoint}</dd></div>
          )}
          {p.topic && (
            <div className="flex gap-2"><dt className="text-slate-500 w-20">Topic</dt><dd className="font-mono text-slate-800">{p.topic}</dd></div>
          )}
          {p.bucket && (
            <div className="flex gap-2"><dt className="text-slate-500 w-20">Bucket</dt><dd className="font-mono text-slate-800">{p.bucket}</dd></div>
          )}
          <p className="text-[11px] text-slate-500 mt-1 italic">
            Credentials are revealed only at access grant time.
          </p>
        </dl>
      </div>
    );
  }
  return null;
}

/**
 * Consumer-grade snippet picker (closes B-069 partial — replaces the static
 * CONSUMPTION_GUIDANCE placeholder template). Lets the user choose a tool
 * from a dropdown; the snippet is fetched on demand from the per-port
 * snippet endpoint and rendered in a code block with copy-to-clipboard.
 *
 * Visibility mirrors the F10.6 connection-details rule: a user without
 * ownership or an active access grant gets `available: false` with a
 * pointer to the request-access flow. Cross-org grants are still on the
 * known-limit list (see B-071 / the inbound-outbound bridge).
 *
 * Destinations:
 *   - python: real generators for all 6 interface types (preexisting)
 *   - dbt: profiles.yml fragment for sql_jdbc (this PR)
 *   - sql_client / jdbc: bare JDBC URL for sql_jdbc (this PR)
 *   - power_bi / tableau: deferred — returns "not yet supported"
 */
function SnippetPicker({
  productOrgId,
  productId,
  portId,
}: {
  productOrgId: string;
  productId: string;
  portId: string;
}) {
  const [destination, setDestination] = useState<SnippetDestination>('python');
  const [snippet, setSnippet]         = useState<PortSnippetResponse | null>(null);
  const [situation, setSituation]     = useState<PortSituationResponse | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [copied, setCopied]           = useState(false);

  // F10.15 — call the per-port situation endpoint once per port. The result
  // drives the access banner (A vs B + grant/no-grant) and is independent
  // of which destination the user picks; we cache it for the lifetime of
  // the component. A fetch failure leaves the banner hidden and falls back
  // to the snippet's own access reason — no UX regression.
  useEffect(() => {
    let cancelled = false;
    marketplaceApi.products
      .situation(productOrgId, productId, portId)
      .then((s) => {
        if (!cancelled) setSituation(s);
      })
      .catch(() => {
        // Silent fallback — the snippet endpoint still gates correctly on
        // its own; the situation banner is an additive UX hint.
      });
    return () => { cancelled = true; };
  }, [productOrgId, productId, portId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCopied(false);
    marketplaceApi.products
      .snippet(productOrgId, productId, portId, destination)
      .then((s) => {
        if (cancelled) return;
        setSnippet(s);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load snippet');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [productOrgId, productId, portId, destination]);

  const handleCopy = () => {
    if (!snippet?.code) return;
    void navigator.clipboard.writeText(snippet.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="border border-slate-200 rounded-lg p-3 mb-3">
      {situation && <SituationBanner situation={situation} />}
      <div className="flex items-center gap-2 mb-2">
        <label className="text-xs font-semibold text-slate-700">How to consume:</label>
        <select
          value={destination}
          onChange={(e) => setDestination(e.target.value as SnippetDestination)}
          className="text-xs border border-slate-300 rounded px-2 py-1 bg-white"
        >
          {SNIPPET_DESTINATIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {snippet?.code && (
          <button
            type="button"
            onClick={handleCopy}
            className="ml-auto text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 text-slate-700"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        )}
      </div>

      {loading && (
        <div className="text-xs text-slate-400 italic px-2 py-3">Loading snippet…</div>
      )}

      {!loading && error && (
        <div className="text-xs text-red-600 px-2 py-3">{error}</div>
      )}

      {!loading && !error && snippet && !snippet.available && (
        <SnippetUnavailable reason={snippet.reason} />
      )}

      {!loading && !error && snippet?.available && snippet.code && (
        <pre className="text-xs font-mono bg-slate-900 text-slate-100 rounded p-3 overflow-x-auto whitespace-pre">
          {snippet.code}
        </pre>
      )}
    </div>
  );
}

/**
 * SituationBanner — F10.15 (Phase 5.9) consumer-flow signal. Renders an
 * accessibility hint per port:
 *   - Situation A: producer-declared open to all source-system users; no
 *     per-product grant needed.
 *   - Situation B + grant: you have access; just pick a tool.
 *   - Situation B + no grant: you'll need to request access; the snippet
 *     stays empty until approval. (The full Request Access action lives
 *     in the Access tab — this banner just sets expectations.)
 *
 * Exported for test isolation.
 */
export function SituationBanner({ situation }: { situation: PortSituationResponse }) {
  if (situation.situation === 'A') {
    return (
      <div className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-1.5 mb-2">
        <strong className="font-semibold">Open access.</strong>{' '}
        No per-product access request needed — connect with your existing
        source-system credentials.
      </div>
    );
  }
  if (situation.callerHasActiveGrant) {
    return (
      <div className="text-[11px] text-blue-800 bg-blue-50 border border-blue-200 rounded px-2 py-1.5 mb-2">
        <strong className="font-semibold">Access granted.</strong>{' '}
        Pick a tool to generate a ready-to-use snippet.
      </div>
    );
  }
  return (
    <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-2">
      <strong className="font-semibold">Access required.</strong>{' '}
      Use the Access tab to request access; the snippet renders with real
      connection details once approved.
    </div>
  );
}

function SnippetUnavailable({ reason }: { reason: PortSnippetResponse['reason'] }) {
  switch (reason) {
    case 'request_access_required':
      return (
        <div className="text-xs text-slate-600 px-2 py-3 bg-slate-50 rounded">
          You need an active access grant on this product before the snippet renders with real connection
          details. Use the Request Access action above to start the approval flow.
        </div>
      );
    case 'destination_not_yet_supported':
      return (
        <div className="text-xs text-amber-700 px-2 py-3 bg-amber-50 rounded">
          A snippet for this tool / interface combination is not yet generated. Pick another destination from the
          dropdown, or check back later.
        </div>
      );
    case 'port_has_no_connection_details':
      return (
        <div className="text-xs text-slate-600 px-2 py-3 bg-slate-50 rounded">
          This port has not yet been wired with connection details. The product owner needs to populate them
          before a snippet can be generated.
        </div>
      );
    default:
      return (
        <div className="text-xs text-slate-600 px-2 py-3 bg-slate-50 rounded">
          Snippet is not available for this port.
        </div>
      );
  }
}

function PortsTab({
  ports,
  productOrgId,
  productId,
}: {
  ports: Port[];
  productOrgId: string;
  productId: string;
}) {
  const outputPorts = ports.filter((p) => p.portType === 'output');

  if (outputPorts.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 text-sm text-slate-500">
        No output ports declared.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {outputPorts.map((port) => {
        const fields = extractFieldsFromContract(port.contractSchema);

        return (
          <div key={port.id} className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">{port.name}</h3>
                {/* F10.14 / Phase 5.11 — surface the catalog name when set. This
                    is the identifier the consumer will paste into their tools,
                    so we lift it above the description and render it
                    monospace + slightly emphasised. */}
                {port.catalogName && (
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[11px] uppercase tracking-wide text-slate-400">Catalog name</span>
                    <code className="text-xs font-mono text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                      {port.catalogName}
                    </code>
                  </div>
                )}
                {port.description && (
                  <p className="text-xs text-slate-500 mt-1">{port.description}</p>
                )}
              </div>
              {port.interfaceType && (
                <span className={`px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${INTERFACE_COLORS[port.interfaceType]}`}>
                  {INTERFACE_LABELS[port.interfaceType]}
                </span>
              )}
            </div>

            {port.slaDescription && (
              <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 mb-3">
                <span className="font-medium text-slate-700">SLO: </span>
                {port.slaDescription}
              </div>
            )}

            <ConnectionDetailsPanel port={port} />

            <SnippetPicker productOrgId={productOrgId} productId={productId} portId={port.id} />

            {fields.length > 0 ? (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide">Field</th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide">Type</th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide">Required</th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {fields.map((f) => (
                      <tr key={f.name}>
                        <td className="px-3 py-2 font-mono text-slate-900">{f.name}</td>
                        <td className="px-3 py-2 font-mono text-brand-700">{f.type}</td>
                        <td className="px-3 py-2 text-slate-500">{f.required ? 'Yes' : 'No'}</td>
                        <td className="px-3 py-2 text-slate-600">{f.description ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : port.contractSchema ? (
              <details className="text-xs">
                <summary className="cursor-pointer text-brand-600 hover:text-brand-800 font-medium select-none">
                  View raw contract schema
                </summary>
                <pre className="mt-2 bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto text-xs leading-relaxed">
                  {JSON.stringify(port.contractSchema, null, 2)}
                </pre>
              </details>
            ) : (
              <p className="text-xs text-slate-400 italic">
                No contract schema declared yet — port owner has not published field definitions.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

type EffectiveAccessState = 'owner' | 'granted' | 'pending' | 'denied' | 'cross_org' | 'not_requested';

function deriveAccessState(
  product: MarketplaceProductDetail,
  principalId: string | undefined,
  callerOrgId: string | undefined,
  submittedRequest: AccessRequest | null,
): EffectiveAccessState {
  if (principalId && product.ownerPrincipalId === principalId) return 'owner';
  if (submittedRequest && submittedRequest.status === 'pending') return 'pending';
  const status: ProductAccessStatusValue | undefined = product.accessStatus?.status;
  if (status === 'granted')       return 'granted';
  if (status === 'pending')       return 'pending';
  if (status === 'denied')        return 'denied';
  // Marketplace is cross-org but the access-request endpoint is org-scoped
  // (`/organizations/:orgId/access/requests`) and the API rejects requests
  // when product.org_id !== caller.org_id with 403. Surface the constraint
  // visually instead of letting the user click into a 403.
  if (callerOrgId && product.orgId !== callerOrgId) return 'cross_org';
  return 'not_requested';
}

function AccessTab({
  product,
  onRequestAccess,
  onAccessRenewed,
  effectiveState,
}: {
  product: MarketplaceProductDetail;
  onRequestAccess: () => void;
  onAccessRenewed: () => void;
  effectiveState: EffectiveAccessState;
}) {
  const { principalId, orgId: callerOrgId } = useAuth();

  const [myRequest, setMyRequest]   = useState<AccessRequest | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [renewing, setRenewing]     = useState(false);
  const [renewMessage, setRenewMessage] = useState<{ kind: 'success' | 'pending' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!principalId) { setLoading(false); return; }
    marketplaceApi.products.accessRequestsGlobal(product.id)
      .then((res) => {
        const req = res.items.find((r) => r.productId === product.id) ?? null;
        setMyRequest(req);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Failed to load access status');
        setLoading(false);
      });
  }, [product.id, principalId]);

  // F10.19 / Phase 5.13 — consumer-initiated renewal. The grant lives in
  // the requester's org per Model A; orgId on the URL is the caller's org.
  // Calls /access/grants/:grantId/renew and branches on `mode`:
  //   - auto_renewed → success toast with new expiry; parent refreshes
  //     the product so accessStatus.expiresAt picks up the extension.
  //   - approval_required → pending-message; parent refreshes so the
  //     pending request appears in the tab.
  const handleRenew = async () => {
    if (!callerOrgId || !product.accessStatus?.grantId) return;
    setRenewing(true);
    setRenewMessage(null);
    try {
      const result = await accessApi.grants.renew(callerOrgId, product.accessStatus.grantId);
      if (result.mode === 'auto_renewed' && result.grant) {
        const newExpiry = result.grant.expiresAt
          ? new Date(result.grant.expiresAt).toLocaleDateString()
          : 'no expiry';
        setRenewMessage({
          kind: 'success',
          text: `Renewed — new expiry ${newExpiry}`,
        });
      } else {
        setRenewMessage({
          kind: 'pending',
          text: 'Renewal request sent. The product owner will review; you keep access in the meantime.',
        });
      }
      onAccessRenewed();
    } catch (err) {
      setRenewMessage({
        kind: 'error',
        text: err instanceof ApiError ? err.message : 'Renewal failed',
      });
    } finally {
      setRenewing(false);
    }
  };

  if (loading) return <LoadingState label="access status" />;
  if (error)   return <ErrorState message={error} />;

  return (
    <div className="space-y-4">
      {effectiveState === 'owner' && (
        <div className="bg-brand-50 border border-brand-200 rounded-xl p-5">
          <p className="text-sm font-semibold text-brand-800">You own this product</p>
          <p className="text-xs text-brand-700 mt-1">
            As the product owner you have full access. Access requests from consumers will be routed to you for review.
          </p>
        </div>
      )}

      {effectiveState === 'granted' && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5">
          <p className="text-sm font-semibold text-green-800">You have access</p>
          <p className="text-xs text-green-700 mt-1">
            {product.accessStatus?.grantedAt
              ? `Granted ${new Date(product.accessStatus.grantedAt).toLocaleDateString()}`
              : 'Your access grant is active.'}
            {product.accessStatus?.expiresAt
              ? ` · Expires ${new Date(product.accessStatus.expiresAt).toLocaleDateString()}`
              : ''}
          </p>
          {myRequest?.resolutionNote && (
            <p className="text-xs text-green-700 mt-1">Note: {myRequest.resolutionNote}</p>
          )}
          {/* F10.19 — renewal CTA. Only renders when the active grant has
              an expiry (perpetual grants can't be renewed) AND we have
              the grant id from the access-status enrichment. */}
          {product.accessStatus?.expiresAt && product.accessStatus.grantId && (
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleRenew()}
                disabled={renewing}
                className="text-xs px-3 py-1.5 rounded-md border border-green-300 bg-white text-green-800 hover:bg-green-100 disabled:opacity-50 transition-colors"
              >
                {renewing ? 'Renewing…' : 'Renew access'}
              </button>
              {renewMessage && (
                <span
                  className={
                    renewMessage.kind === 'success'
                      ? 'text-xs text-green-800 font-medium'
                      : renewMessage.kind === 'pending'
                      ? 'text-xs text-amber-700'
                      : 'text-xs text-red-700'
                  }
                >
                  {renewMessage.text}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {effectiveState === 'pending' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5">
          <p className="text-sm font-semibold text-yellow-800">Request pending</p>
          <p className="text-xs text-yellow-700 mt-1">
            Your request is awaiting review by the data product owner
            {myRequest?.requestedAt ? `. Submitted ${new Date(myRequest.requestedAt).toLocaleDateString()}` : '.'}
          </p>
        </div>
      )}

      {effectiveState === 'denied' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5">
          <p className="text-sm font-semibold text-red-800">Request denied</p>
          <p className="text-xs text-red-700 mt-1">
            A previous access request was denied. Contact the product owner before submitting a new request.
          </p>
        </div>
      )}

      {effectiveState === 'cross_org' && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
          <p className="text-sm font-semibold text-slate-800">Different organisation</p>
          <p className="text-xs text-slate-600 mt-1">
            This product belongs to another organisation. Cross-organisation access requests are not supported on this platform yet — contact the publishing organisation directly.
          </p>
        </div>
      )}

      {effectiveState === 'not_requested' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-sm text-slate-600 mb-4">
            You do not currently have access to this product.
          </p>
          <button
            type="button"
            onClick={onRequestAccess}
            className="bg-brand-600 text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-brand-700 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
          >
            Request Access
          </button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Access Overview</h3>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs text-slate-400">Active consumers</dt>
            <dd className="text-slate-700 font-medium">{product.activeConsumerCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">Classification</dt>
            <dd>
              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${CLASSIFICATION_STYLES[product.classification]}`}>
                {product.classification}
              </span>
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-slate-400 text-sm" aria-busy="true" aria-label={`Loading ${label}`}>
      <div className="h-4 w-4 rounded-full border-2 border-slate-300 border-t-brand-500 animate-spin" aria-hidden />
      Loading {label}…
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page skeleton
// ---------------------------------------------------------------------------

function PageSkeleton() {
  return (
    <div className="p-6 max-w-screen-lg mx-auto animate-pulse" aria-busy="true" aria-label="Loading product details">
      <div className="h-6 bg-slate-200 rounded w-1/3 mb-2" />
      <div className="h-4 bg-slate-100 rounded w-1/4 mb-6" />
      <div className="h-32 bg-slate-100 rounded-xl mb-4" />
      <div className="flex gap-4 border-b border-slate-200 mb-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-8 bg-slate-100 rounded w-16" />
        ))}
      </div>
      <div className="space-y-4">
        <div className="h-24 bg-slate-100 rounded-xl" />
        <div className="h-16 bg-slate-100 rounded-xl" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function ProductDetailPage() {
  const { productId } = useParams<{ orgId: string; productId: string }>();
  const { principalId, orgId: callerOrgId } = useAuth();
  const [product, setProduct]           = useState<MarketplaceProductDetail | null>(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [activeTab, setActiveTab]       = useState<TabId>('overview');
  const [showAccessRequest, setShowAccessRequest] = useState(false);
  const [submittedRequest, setSubmittedRequest]   = useState<AccessRequest | null>(null);

  const reloadProduct = useCallback(() => {
    if (!productId) return;
    marketplaceApi.products.getGlobal(productId)
      .then((p) => setProduct(p))
      .catch(() => {
        // Silent — a reload failure leaves the prior state intact; the
        // initial fetch's error handling stays in the main load path.
      });
  }, [productId]);

  useEffect(() => {
    if (!productId) return;
    setLoading(true);
    setError(null);
    marketplaceApi.products.getGlobal(productId)
      .then((p) => { setProduct(p); setLoading(false); })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Failed to load product');
        setLoading(false);
      });
  }, [productId]);

  if (!productId) {
    return <div className="p-6 text-sm text-red-600">Invalid URL parameters.</div>;
  }

  if (loading) return <PageSkeleton />;

  if (error || !product) {
    return (
      <div className="p-6">
        <Link to="/marketplace" className="text-sm text-brand-600 hover:underline">← Back to Marketplace</Link>
        <div role="alert" className="mt-4 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {error ?? 'Product not found.'}
        </div>
      </div>
    );
  }

  const outputPorts     = product.ports.filter((p) => p.portType === 'output');
  const effectiveState  = deriveAccessState(product, principalId, callerOrgId, submittedRequest);

  function handleRequestSubmitted(req: AccessRequest) {
    setSubmittedRequest(req);
    setShowAccessRequest(false);
    setActiveTab('access');
  }

  return (
    <div className="p-6 max-w-screen-lg mx-auto">
      {/* Breadcrumb */}
      <nav className="mb-4" aria-label="Breadcrumb">
        <Link
          to="/marketplace"
          className="text-sm text-brand-600 hover:text-brand-800 hover:underline"
        >
          ← Marketplace
        </Link>
      </nav>

      <LifecycleBanner status={product.status} />

      {/* Header */}
      <div className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h1 className="text-xl font-bold text-slate-900">{product.name}</h1>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[product.status]}`}>
                {product.status}
              </span>
              {product.complianceState && (
                <span className={`px-2 py-0.5 rounded text-xs font-medium border ${COMPLIANCE_BADGE[product.complianceState]}`}>
                  {COMPLIANCE_LABEL[product.complianceState]}
                </span>
              )}
              <FreshnessBadge product={product} />
            </div>
            <p className="text-sm text-slate-500">
              {product.domainName} · v{product.version} · Updated {new Date(product.updatedAt).toLocaleDateString()}
            </p>
          </div>

          {/* Primary CTA — branches on ownership + current access state */}
          {effectiveState === 'owner' && (
            <span className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-50 text-brand-700 border border-brand-200">
              You own this product
            </span>
          )}
          {effectiveState === 'granted' && (
            <span className="px-4 py-2 text-sm font-medium rounded-lg bg-green-50 text-green-700 border border-green-200">
              You have access
            </span>
          )}
          {effectiveState === 'pending' && (
            <span className="px-4 py-2 text-sm font-medium rounded-lg bg-yellow-50 text-yellow-700 border border-yellow-200">
              Request pending
            </span>
          )}
          {effectiveState === 'denied' && (
            <span className="px-4 py-2 text-sm font-medium rounded-lg bg-red-50 text-red-700 border border-red-200">
              Access denied
            </span>
          )}
          {effectiveState === 'cross_org' && (
            <span className="px-4 py-2 text-sm font-medium rounded-lg bg-slate-50 text-slate-600 border border-slate-200">
              Different organisation
            </span>
          )}
          {effectiveState === 'not_requested' && (
            <button
              type="button"
              onClick={() => setShowAccessRequest(true)}
              className="flex-shrink-0 bg-brand-600 text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-brand-700 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
            >
              Request Access
            </button>
          )}
        </div>
      </div>

      {/* Trust score panel */}
      <div className="mb-6">
        <TrustScorePanel productId={productId} orgId={product.orgId} />
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 mb-6">
        <nav className="flex gap-1 -mb-px" role="tablist" aria-label="Product detail tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`tabpanel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 rounded-t ${
                activeTab === tab.id
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab panels */}
      <div id={`tabpanel-${activeTab}`} role="tabpanel" aria-label={activeTab}>
        {activeTab === 'overview' && <OverviewTab product={product} />}
        {activeTab === 'schema'   && <SchemaTab   productId={productId} />}
        {activeTab === 'ports'    && <PortsTab    ports={product.ports} productOrgId={product.orgId} productId={product.id} />}
        {activeTab === 'lineage'  && <LineageExplorer productId={productId} orgId={product.orgId} />}
        {activeTab === 'slos'     && <ObservabilityDashboard productId={productId} orgId={product.orgId} />}
        {activeTab === 'access'   && (
          <AccessTab
            product={product}
            onRequestAccess={() => setShowAccessRequest(true)}
            onAccessRenewed={reloadProduct}
            effectiveState={effectiveState}
          />
        )}
      </div>

      {/* Access request slide-over */}
      {showAccessRequest && (
        <AccessRequestSlideOver
          orgId={product.orgId}
          productId={productId}
          productName={product.name}
          outputPorts={outputPorts}
          existingRequest={submittedRequest}
          onClose={() => setShowAccessRequest(false)}
          onSubmitted={handleRequestSubmitted}
        />
      )}
    </div>
  );
}
