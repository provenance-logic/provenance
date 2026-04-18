import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { marketplaceApi } from '../../shared/api/marketplace.js';
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

const CONSUMPTION_GUIDANCE: Record<OutputPortInterfaceType, { heading: string; body: string }> = {
  sql_jdbc: {
    heading: 'Connect via JDBC',
    body:    'jdbc:<driver>://<host>:<port>/<database>?user=<principal>&sslmode=require',
  },
  rest_api: {
    heading: 'Call the REST API',
    body:    'curl -H "Authorization: Bearer $TOKEN" https://<base-url>/<resource>',
  },
  graphql: {
    heading: 'Query via GraphQL',
    body:    'POST https://<base-url>/graphql  with  { query }  — send an access token in Authorization',
  },
  streaming_topic: {
    heading: 'Subscribe to the topic',
    body:    'Topic: <topic-name>  ·  Brokers: <broker-list>  ·  Schema registry: <registry-url>',
  },
  file_object_export: {
    heading: 'Read the exported files',
    body:    '<bucket>/<prefix>/<partition>/...  — access via object-store SDK with the granted IAM role',
  },
  semantic_query_endpoint: {
    heading: 'Query with natural language (agents)',
    body:    'MCP tool: semantic_search  ·  arg: { productId, query }  — requires an agent trust classification',
  },
};

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
    </div>
  );
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

function PortsTab({ ports }: { ports: Port[] }) {
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
        const fields   = extractFieldsFromContract(port.contractSchema);
        const guidance = port.interfaceType ? CONSUMPTION_GUIDANCE[port.interfaceType] : null;

        return (
          <div key={port.id} className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">{port.name}</h3>
                {port.description && (
                  <p className="text-xs text-slate-500 mt-0.5">{port.description}</p>
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

            {guidance && (
              <div className="border border-brand-100 bg-brand-50 rounded-lg p-3 mb-3">
                <p className="text-xs font-semibold text-brand-800 mb-1">How to consume — {guidance.heading}</p>
                <code className="block text-xs font-mono text-brand-900 whitespace-pre-wrap break-all">
                  {guidance.body}
                </code>
              </div>
            )}

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

type EffectiveAccessState = 'owner' | 'granted' | 'pending' | 'denied' | 'not_requested';

function deriveAccessState(
  product: MarketplaceProductDetail,
  principalId: string | undefined,
  submittedRequest: AccessRequest | null,
): EffectiveAccessState {
  if (principalId && product.ownerPrincipalId === principalId) return 'owner';
  if (submittedRequest && submittedRequest.status === 'pending') return 'pending';
  const status: ProductAccessStatusValue | undefined = product.accessStatus?.status;
  if (status === 'granted')       return 'granted';
  if (status === 'pending')       return 'pending';
  if (status === 'denied')        return 'denied';
  return 'not_requested';
}

function AccessTab({
  product,
  onRequestAccess,
  effectiveState,
}: {
  product: MarketplaceProductDetail;
  onRequestAccess: () => void;
  effectiveState: EffectiveAccessState;
}) {
  const { principalId } = useAuth();

  const [myRequest, setMyRequest]   = useState<AccessRequest | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);

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
  const { principalId } = useAuth();
  const [product, setProduct]           = useState<MarketplaceProductDetail | null>(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [activeTab, setActiveTab]       = useState<TabId>('overview');
  const [showAccessRequest, setShowAccessRequest] = useState(false);
  const [submittedRequest, setSubmittedRequest]   = useState<AccessRequest | null>(null);

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
  const effectiveState  = deriveAccessState(product, principalId, submittedRequest);

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
        {activeTab === 'ports'    && <PortsTab    ports={product.ports} />}
        {activeTab === 'lineage'  && <LineageExplorer productId={productId} orgId={product.orgId} />}
        {activeTab === 'slos'     && <ObservabilityDashboard productId={productId} orgId={product.orgId} />}
        {activeTab === 'access'   && (
          <AccessTab
            product={product}
            onRequestAccess={() => setShowAccessRequest(true)}
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
