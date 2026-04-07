import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { marketplaceApi } from '../../shared/api/marketplace.js';
import { ApiError } from '../../shared/api/client.js';
import { useAuth } from '../../auth/AuthProvider.js';
import { AccessRequestSlideOver } from './AccessRequestSlideOver.js';
import type {
  MarketplaceProductDetail,
  ProductSchema,
  LineageGraph,
  SloSummary,
  TrustScoreBreakdown,
  Port,
  AccessRequest,
  DataClassification,
  ComplianceStateValue,
  OutputPortInterfaceType,
} from '@provenance/types';

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
// Trust score panel
// ---------------------------------------------------------------------------

const DIMENSION_LABELS: Record<string, string> = {
  governanceCompliance: 'Governance Compliance',
  lineageCompleteness:  'Lineage Completeness',
  sloCompliance:        'SLO Compliance',
  schemaConformance:    'Schema Conformance',
  freshness:            'Freshness',
};

const DIMENSION_INFO: Record<string, { measures: string; contribution: string; improve: string }> = {
  governanceCompliance: {
    measures: 'Whether the product satisfies all active governance policies. Scored as Compliant = 1.0, Grace Period = 0.75, Drift = 0.50, Non-Compliant = 0.25.',
    contribution: '30% of the composite trust score.',
    improve: 'Resolve all policy violations and ensure the product passes governance evaluation on every publish.',
  },
  lineageCompleteness: {
    measures: 'Fraction of upstream lineage edges that are declared and verified in the lineage graph.',
    contribution: '25% of the composite trust score. Locked at 1.0 until Phase 3.',
    improve: 'Declare all upstream data sources and verify lineage edges using the emission SDK.',
  },
  sloCompliance: {
    measures: 'Ratio of SLO targets met over the last 90 days, measured by the observability pipeline.',
    contribution: '20% of the composite trust score. Locked at 1.0 until Phase 3.',
    improve: 'Define SLO targets on output ports and ensure freshness, availability, and latency stay within bounds.',
  },
  schemaConformance: {
    measures: 'Whether schema changes are declared semantically and pass the contract validation gate.',
    contribution: '15% of the composite trust score. Locked at 1.0 until Phase 3.',
    improve: 'Use semantic versioning for schema changes and ensure all output ports have a valid contract schema.',
  },
  freshness: {
    measures: 'How recently the data was updated relative to the declared freshness SLO.',
    contribution: '10% of the composite trust score. Locked at 1.0 until Phase 3.',
    improve: 'Keep data refreshes on schedule and tighten freshness SLOs to match consumer expectations.',
  },
};

function TrustScorePanel({ breakdown }: { breakdown: TrustScoreBreakdown }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const pct = Math.round(breakdown.composite * 100);
  const color =
    pct >= 80 ? 'text-green-700' : pct >= 60 ? 'text-yellow-700' : pct >= 40 ? 'text-orange-700' : 'text-red-700';
  const ring =
    pct >= 80 ? 'ring-green-400' : pct >= 60 ? 'ring-yellow-400' : pct >= 40 ? 'ring-orange-400' : 'ring-red-400';

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-slate-700 mb-4">Trust Score</h2>
      <div className="flex items-center gap-6">
        {/* Big score */}
        <div
          className={`flex-shrink-0 w-20 h-20 rounded-full ring-4 ${ring} flex items-center justify-center`}
          aria-label={`Trust score ${pct} out of 100`}
        >
          <span className={`text-2xl font-bold ${color}`}>{pct}</span>
        </div>

        {/* Dimension breakdown */}
        <div className="flex-1 space-y-1 min-w-0">
          {Object.entries(breakdown.dimensions).map(([key, dim]) => {
            const info = DIMENSION_INFO[key];
            const isOpen = expanded === key;
            return (
              <div key={key}>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-44 truncate">
                    {DIMENSION_LABELS[key]}
                  </span>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        dim.available
                          ? dim.score >= 0.8 ? 'bg-green-500'
                          : dim.score >= 0.6 ? 'bg-yellow-500'
                          : dim.score >= 0.4 ? 'bg-orange-500'
                          : 'bg-red-500'
                          : 'bg-slate-300'
                      }`}
                      style={{ width: `${Math.round(dim.score * 100)}%` }}
                      role="progressbar"
                      aria-valuenow={Math.round(dim.score * 100)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={DIMENSION_LABELS[key]}
                    />
                  </div>
                  <span className="text-xs font-medium text-slate-600 w-8 text-right">
                    {dim.available ? `${Math.round(dim.score * 100)}` : '—'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : key)}
                    className={`flex-shrink-0 transition-colors rounded focus:outline-none focus:ring-1 focus:ring-brand-500 ${
                      isOpen ? 'text-brand-600' : 'text-slate-300 hover:text-slate-500'
                    }`}
                    aria-label={`${isOpen ? 'Hide' : 'Show'} details for ${DIMENSION_LABELS[key]}`}
                    aria-expanded={isOpen}
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
                    </svg>
                  </button>
                  {!dim.available && (
                    <span className="text-xs text-slate-300 italic">Phase 3</span>
                  )}
                </div>
                {isOpen && info && (
                  <div className="ml-44 pl-2 mt-1 mb-2 border-l-2 border-brand-200 text-xs text-slate-600 space-y-1">
                    <p><span className="font-medium text-slate-700">Measures:</span> {info.measures}</p>
                    <p><span className="font-medium text-slate-700">Weight:</span> {info.contribution}</p>
                    <p><span className="font-medium text-slate-700">Improve:</span> {info.improve}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-4 text-xs text-slate-400">
        Composite score = Σ (dimension score × weight). Click the ⓘ icons for details.
        Phase 3 dimensions are locked at 1.0 until real data is available.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab contents
// ---------------------------------------------------------------------------

function OverviewTab({ product }: { product: MarketplaceProductDetail }) {
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
      {outputPorts.map((port) => (
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

          {port.contractSchema && (
            <details className="text-xs">
              <summary className="cursor-pointer text-brand-600 hover:text-brand-800 font-medium select-none">
                View contract schema
              </summary>
              <pre className="mt-2 bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto text-xs leading-relaxed">
                {JSON.stringify(port.contractSchema, null, 2)}
              </pre>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}

function LineageTab({ productId }: { productId: string }) {
  const [lineage, setLineage]   = useState<LineageGraph | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [depth, setDepth]       = useState(3);

  const load = useCallback((d: number) => {
    setLoading(true);
    setError(null);
    marketplaceApi.products.lineageGlobal(productId, d)
      .then((g) => { setLineage(g); setLoading(false); })
      .catch((err) => { setError(err instanceof ApiError ? err.message : 'Failed to load lineage'); setLoading(false); });
  }, [productId]);

  useEffect(() => { load(depth); }, [load, depth]);

  if (loading) return <LoadingState label="lineage graph" />;
  if (error)   return <ErrorState message={error} />;
  if (!lineage) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label htmlFor="lineageDepth" className="text-sm text-slate-600 font-medium">Traversal depth</label>
        <select
          id="lineageDepth"
          value={depth}
          onChange={(e) => setDepth(parseInt(e.target.value, 10))}
          className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{d} hop{d !== 1 ? 's' : ''}</option>)}
        </select>
      </div>

      {lineage.isPlaceholder ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
          <p className="text-sm font-medium text-amber-800">Lineage graph coming in Phase 3</p>
          <p className="mt-1 text-xs text-amber-600">
            The Neo4j lineage graph will be wired up in Phase 3. Once live, this view will show
            upstream source systems, transformations, and downstream consumers with configurable
            traversal depth.
          </p>
          <div className="mt-4 flex justify-center">
            {/* Minimal placeholder graph: one node */}
            <div className="flex flex-col items-center gap-1">
              <div className="w-32 h-10 rounded-lg bg-brand-100 border border-brand-300 flex items-center justify-center">
                <span className="text-xs font-medium text-brand-700 truncate px-2">{lineage.nodes[0]?.label}</span>
              </div>
              <span className="text-xs text-slate-400">← this product</span>
            </div>
          </div>
        </div>
      ) : (
        // Real lineage data (Phase 3): render node/edge list until react-flow is wired.
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Nodes ({lineage.nodes.length})</h3>
            <div className="flex flex-wrap gap-2">
              {lineage.nodes.map((n) => (
                <span key={n.id} className="px-2 py-1 bg-slate-100 rounded text-xs text-slate-700">
                  {n.label} <span className="text-slate-400">({n.type})</span>
                </span>
              ))}
            </div>
          </div>
          {lineage.edges.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Edges ({lineage.edges.length})</h3>
              <div className="space-y-1">
                {lineage.edges.map((e) => (
                  <p key={e.id} className="text-xs text-slate-600">
                    <span className="font-mono">{e.source}</span>
                    {' → '}
                    <span className="text-slate-400 italic">{e.label}</span>
                    {' → '}
                    <span className="font-mono">{e.target}</span>
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SlosTab({ productId }: { productId: string }) {
  const [slos, setSlos]   = useState<SloSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    marketplaceApi.products.slosGlobal(productId)
      .then((s) => { setSlos(s); setLoading(false); })
      .catch((err) => { setError(err instanceof ApiError ? err.message : 'Failed to load SLOs'); setLoading(false); });
  }, [productId]);

  if (loading) return <LoadingState label="SLOs" />;
  if (error)   return <ErrorState message={error} />;
  if (!slos)   return null;

  return (
    <div className="space-y-4">
      {slos.isPlaceholder && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-xs text-amber-700">
          SLO evaluation history is a Phase 3 feature. The declarations below come from port
          SLA descriptions; actual compliance metrics will be computed by the observability
          pipeline in Phase 3.
        </div>
      )}
      {slos.declarations.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-5 text-sm text-slate-500">
          No SLOs declared on output ports. Add an SLA description to an output port to populate this view.
        </div>
      ) : (
        <div className="space-y-3">
          {slos.declarations.map((d) => (
            <div key={d.portId} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-800">{d.portName}</span>
                <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-500">unknown</span>
              </div>
              {d.description ? (
                <p className="mt-1 text-xs text-slate-600">{d.description}</p>
              ) : (
                <p className="mt-1 text-xs text-slate-400 italic">No SLA description provided.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AccessTab({
  product,
  onRequestAccess,
}: {
  product: MarketplaceProductDetail;
  onRequestAccess: () => void;
}) {
  const { keycloak } = useAuth();
  const principalId = keycloak.tokenParsed?.sub;

  const [myRequest, setMyRequest]   = useState<AccessRequest | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);

  useEffect(() => {
    if (!principalId) return;
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

  const hasActiveRequest = myRequest && myRequest.status === 'pending';
  const approved         = myRequest && myRequest.status === 'approved';

  return (
    <div className="space-y-4">
      {/* Current status */}
      {approved && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5">
          <p className="text-sm font-semibold text-green-800">Access Approved</p>
          <p className="text-xs text-green-700 mt-1">
            Your access request was approved
            {myRequest.resolvedAt ? ` on ${new Date(myRequest.resolvedAt).toLocaleDateString()}` : ''}.
          </p>
          {myRequest.resolutionNote && (
            <p className="text-xs text-green-700 mt-1">Note: {myRequest.resolutionNote}</p>
          )}
        </div>
      )}

      {hasActiveRequest && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5">
          <p className="text-sm font-semibold text-yellow-800">Request Pending</p>
          <p className="text-xs text-yellow-700 mt-1">
            Your request is awaiting review by the data product owner. Submitted{' '}
            {new Date(myRequest.requestedAt).toLocaleDateString()}.
          </p>
        </div>
      )}

      {!approved && !hasActiveRequest && (
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

      {/* Product stats */}
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

  const outputPorts = product.ports.filter((p) => p.portType === 'output');

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
            </div>
            <p className="text-sm text-slate-500">
              {product.domainName} · v{product.version} · Updated {new Date(product.updatedAt).toLocaleDateString()}
            </p>
          </div>

          {/* Primary CTA */}
          {submittedRequest ? (
            <span className="px-4 py-2 text-sm font-medium rounded-lg bg-yellow-50 text-yellow-700 border border-yellow-200">
              Request Pending
            </span>
          ) : (
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
        <TrustScorePanel breakdown={product.trustScoreBreakdown} />
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
        {activeTab === 'lineage'  && <LineageTab  productId={productId} />}
        {activeTab === 'slos'     && <SlosTab     productId={productId} />}
        {activeTab === 'access'   && (
          <AccessTab
            product={product}
            onRequestAccess={() => setShowAccessRequest(true)}
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
