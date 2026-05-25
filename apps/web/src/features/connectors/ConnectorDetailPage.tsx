import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type {
  Connector,
  DiscoveryCrawlEventRecord,
  DiscoveryCrawlStatus,
  SourceRegistration,
  ValidationStatus,
} from '@provenance/types';
import { useOrgId } from '../../shared/hooks/useOrgId.js';
import { connectorsApi } from '../../shared/api/connectors.js';
import { formatRelativeTime } from '../../shared/utils/format-time.js';
import type { SourceBindingNavState } from '../../shared/navigation/source-binding-nav.js';

// ---------------------------------------------------------------------------
// Shared constants (mirrors ConnectorsPage — no cross-file import of impl)
// ---------------------------------------------------------------------------

const CONNECTOR_TYPE_LABELS: Record<string, string> = {
  postgresql:  'PostgreSQL',
  databricks:  'Databricks',
  s3:          'S3',
  snowflake:   'Snowflake',
};

const VALIDATION_PILL: Record<ValidationStatus, string> = {
  pending:  'bg-slate-100 text-slate-700',
  valid:    'bg-green-100 text-green-800',
  invalid:  'bg-red-100 text-red-800',
  stale:    'bg-amber-100 text-amber-800',
};

const CRAWL_STATUS_PILL: Record<DiscoveryCrawlStatus, string> = {
  running:   'bg-blue-100 text-blue-800',
  succeeded: 'bg-green-100 text-green-800',
  partial:   'bg-amber-100 text-amber-800',
  failed:    'bg-red-100 text-red-800',
};

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Connector detail page (B-075 Surface 1).
 *
 * Surfaces: connector header, discovery summary (latest crawl stats),
 * discovered sources table, and an optional crawl-history accordion.
 *
 * Resolves orgId from the JWT (same pattern as ConnectorsPage — no URL
 * orgId param). Reads :connectorId from the route.
 */
export function ConnectorDetailPage() {
  const { connectorId } = useParams<{ connectorId: string }>();
  const orgId = useOrgId();
  const navigate = useNavigate();

  const [connector, setConnector] = useState<Connector | null>(null);
  const [crawlEvents, setCrawlEvents] = useState<DiscoveryCrawlEventRecord[] | null>(null);
  const [sources, setSources] = useState<SourceRegistration[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [validating, setValidating] = useState(false);
  const [validateResult, setValidateResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [crawling, setCrawling] = useState(false);
  const [crawlResult, setCrawlResult] = useState<{ ok: boolean; message: string } | null>(null);

  const load = useCallback(async () => {
    if (!orgId || !connectorId) return;
    setLoading(true);
    setError(null);
    try {
      const [conn, events, srcs] = await Promise.all([
        connectorsApi.get(orgId, connectorId),
        connectorsApi.listCrawlEvents(orgId, connectorId, 10),
        connectorsApi.listSources(orgId, connectorId, 200, 0),
      ]);
      setConnector(conn);
      setCrawlEvents(events);
      setSources(srcs.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [orgId, connectorId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleValidate() {
    if (!orgId || !connectorId) return;
    setValidating(true);
    setValidateResult(null);
    try {
      const result = await connectorsApi.validate(orgId, connectorId);
      // Reload the connector to pick up the new validationStatus, then report
      // the actual probe outcome inline (not a perpetual "Refreshing…").
      const updated = await connectorsApi.get(orgId, connectorId);
      setConnector(updated);
      setValidateResult(
        result.status === 'healthy'
          ? { ok: true, message: 'Validation passed — connector is reachable and healthy.' }
          : {
              ok: false,
              message: `Validation result: ${result.status}${result.errorMessage ? ` — ${result.errorMessage}` : ''}`,
            },
      );
    } catch (err) {
      setValidateResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setValidating(false);
    }
  }

  async function handleCrawl() {
    if (!orgId || !connectorId) return;
    setCrawling(true);
    setCrawlResult(null);
    try {
      await connectorsApi.crawl(orgId, connectorId);
      // Reload sources and crawl events, then report a terminal result.
      const [events, srcs] = await Promise.all([
        connectorsApi.listCrawlEvents(orgId, connectorId, 10),
        connectorsApi.listSources(orgId, connectorId, 200, 0),
      ]);
      setCrawlEvents(events);
      setSources(srcs.items);
      setCrawlResult({ ok: true, message: `Crawl complete — ${srcs.items.length} source(s) discovered.` });
    } catch (err) {
      setCrawlResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setCrawling(false);
    }
  }

  if (loading && !connector) {
    return <div className="p-8 text-sm text-slate-500">Loading connector…</div>;
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>
        <p className="mt-4 text-sm">
          <Link to="/connectors" className="text-brand-600 hover:text-brand-700">← Back to connectors</Link>
        </p>
      </div>
    );
  }

  if (!connector) return null;

  const latestCrawl = crawlEvents && crawlEvents.length > 0 ? crawlEvents[0] : null;
  const priorCrawls = crawlEvents && crawlEvents.length > 1 ? crawlEvents.slice(1) : [];

  // B-075 Tier A: deep-link into product authoring with this source carried
  // through. The connector knows its own org + domain, so the product is
  // created in the connector's domain; the source identity rides along in
  // router state (see SourceBindingNavState) so the eventual port form can
  // pre-bind to it. The path defaults to the source's sourceRef — the same
  // default the SourceBindingPicker applies — and stays editable downstream.
  function handleCreateProduct(source: SourceRegistration) {
    // The render already early-returns on a null connector, but that narrowing
    // doesn't flow into this closure — re-assert it here.
    if (!connector) return;
    const state: SourceBindingNavState = {
      bindSource: {
        connectorId: connector.id,
        sourceRegistrationId: source.id,
        sourceObjectPath: source.sourceRef,
        sourceDisplayName: source.displayName,
        connectorName: connector.name,
      },
    };
    navigate(`/dashboard/${connector.orgId}/domains/${connector.domainId}/products/new`, { state });
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      {/* Back link */}
      <div>
        <Link to="/connectors" className="text-xs text-slate-500 hover:text-slate-700">
          ← Back to connectors
        </Link>
      </div>

      {/* Header card */}
      <ConnectorHeader
        connector={connector}
        onValidate={() => { void handleValidate(); }}
        onCrawl={() => { void handleCrawl(); }}
        validating={validating}
        crawling={crawling}
        validateResult={validateResult}
        crawlResult={crawlResult}
      />

      {/* Discovery summary */}
      <DiscoverySummary
        latestCrawl={latestCrawl}
        priorCrawls={priorCrawls}
        onCrawl={() => { void handleCrawl(); }}
        crawling={crawling}
      />

      {/* Discovered sources table */}
      <DiscoveredSourcesTable
        sources={sources}
        onCreateProduct={handleCreateProduct}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConnectorHeader
// ---------------------------------------------------------------------------

function ConnectorHeader({
  connector,
  onValidate,
  onCrawl,
  validating,
  crawling,
  validateResult,
  crawlResult,
}: {
  connector: Connector;
  onValidate: () => void;
  onCrawl: () => void;
  validating: boolean;
  crawling: boolean;
  validateResult: { ok: boolean; message: string } | null;
  crawlResult: { ok: boolean; message: string } | null;
}) {
  // Surface non-sensitive connection config fields (host, database, etc).
  // credentialArn is rendered as the ARN string only — the actual secret
  // value never comes from the API.
  const configEntries = Object.entries(connector.connectionConfig).filter(
    ([, v]) => v !== null && v !== undefined && v !== '',
  );

  return (
    <div className="rounded-md border border-slate-200 bg-white p-5 space-y-4">
      {/* Name row */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-semibold text-slate-900">{connector.name}</h1>
            <span className="text-xs uppercase tracking-wide text-slate-500 bg-slate-100 rounded px-2 py-0.5">
              {CONNECTOR_TYPE_LABELS[connector.connectorType] ?? connector.connectorType}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${VALIDATION_PILL[connector.validationStatus]}`}
            >
              {connector.validationStatus}
            </span>
          </div>
          {connector.description && (
            <p className="mt-1 text-sm text-slate-500">{connector.description}</p>
          )}
          {connector.lastValidatedAt && (
            <p className="mt-1 text-xs text-slate-400">
              Last validated {formatRelativeTime(connector.lastValidatedAt)}
            </p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onValidate}
            disabled={validating || crawling}
            className="px-3 py-1.5 rounded-md border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {validating ? 'Validating…' : 'Validate'}
          </button>
          <button
            type="button"
            onClick={onCrawl}
            disabled={crawling || validating}
            className="px-3 py-1.5 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {crawling ? 'Crawling…' : 'Re-crawl'}
          </button>
        </div>
      </div>

      {/* Action feedback */}
      {validateResult && (
        <div
          className={`rounded-md p-2 text-xs ${
            validateResult.ok
              ? 'bg-green-50 border border-green-200 text-green-700'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}
        >
          {validateResult.message}
        </div>
      )}
      {crawlResult && (
        <div
          className={`rounded-md p-2 text-xs ${
            crawlResult.ok
              ? 'bg-green-50 border border-green-200 text-green-700'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}
        >
          {crawlResult.message}
        </div>
      )}

      {/* Connection config summary */}
      {(configEntries.length > 0 || connector.credentialArn) && (
        <div className="border-t border-slate-100 pt-3 space-y-1">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Connection config</p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
            {configEntries.map(([key, val]) => (
              <div key={key}>
                <dt className="text-slate-400 font-mono">{key}</dt>
                <dd className="text-slate-700 font-mono truncate">{String(val)}</dd>
              </div>
            ))}
            {connector.credentialArn && (
              <div>
                <dt className="text-slate-400 font-mono">credentialArn</dt>
                <dd className="text-slate-700 font-mono truncate" title={connector.credentialArn}>
                  {connector.credentialArn}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DiscoverySummary
// ---------------------------------------------------------------------------

/**
 * Renders the latest crawl event as a stat strip, and optionally lists prior
 * crawl events in a collapsed accordion.
 */
export function DiscoverySummary({
  latestCrawl,
  priorCrawls,
  onCrawl,
  crawling,
}: {
  latestCrawl: DiscoveryCrawlEventRecord | null;
  priorCrawls: DiscoveryCrawlEventRecord[];
  onCrawl: () => void;
  crawling: boolean;
}) {
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div className="rounded-md border border-slate-200 bg-white p-5 space-y-4">
      <h2 className="text-sm font-semibold text-slate-900">Discovery summary</h2>

      {latestCrawl === null ? (
        <div className="text-sm text-slate-500 space-y-3">
          <p>No discovery crawl has run yet for this connector.</p>
          <button
            type="button"
            onClick={onCrawl}
            disabled={crawling}
            className="px-3 py-1.5 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {crawling ? 'Crawling…' : 'Run first crawl'}
          </button>
        </div>
      ) : (
        <>
          <CrawlStatStrip event={latestCrawl} />

          {latestCrawl.errorMessage && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3 text-xs text-red-700">
              <span className="font-medium">Crawl error:</span> {latestCrawl.errorMessage}
            </div>
          )}

          {priorCrawls.length > 0 && (
            <div className="border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => setShowHistory((h) => !h)}
                className="text-xs text-slate-500 hover:text-slate-700"
              >
                {showHistory
                  ? `Hide crawl history (${priorCrawls.length} prior ${priorCrawls.length === 1 ? 'run' : 'runs'})`
                  : `Show crawl history (${priorCrawls.length} prior ${priorCrawls.length === 1 ? 'run' : 'runs'})`}
              </button>
              {showHistory && (
                <ul className="mt-3 space-y-3">
                  {priorCrawls.map((e) => (
                    <li key={e.id} className="border border-slate-100 rounded-md p-3">
                      <CrawlStatStrip event={e} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * A single crawl event rendered as a compact stat strip.
 */
export function CrawlStatStrip({ event }: { event: DiscoveryCrawlEventRecord }) {
  const lineageEdges =
    typeof event.metadata?.lineageEdgesEmitted === 'number'
      ? event.metadata.lineageEdgesEmitted
      : null;

  return (
    <div className="space-y-2">
      {/* Status + when */}
      <div className="flex items-center gap-3 flex-wrap">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${CRAWL_STATUS_PILL[event.status]}`}
        >
          {event.status}
        </span>
        <span className="text-xs text-slate-500">
          {formatRelativeTime(event.startedAt)}
          {event.completedAt && (
            <> · completed {formatRelativeTime(event.completedAt)}</>
          )}
        </span>
      </div>

      {/* Stats grid */}
      <dl className="grid grid-cols-3 gap-x-4 gap-y-2 sm:grid-cols-4 lg:grid-cols-6 text-center">
        <StatCell label="Tables found" value={event.tablesFound} />
        <StatCell label="Sources created" value={event.sourcesCreated} />
        <StatCell label="Snapshots" value={event.snapshotsCaptured} />
        {event.snapshotsFailed > 0 && (
          <StatCell label="Snapshots failed" value={event.snapshotsFailed} danger />
        )}
        {lineageEdges !== null && (
          <StatCell label="Lineage edges" value={lineageEdges} />
        )}
        {event.catalogsWalked > 0 && (
          <StatCell label="Catalogs" value={event.catalogsWalked} />
        )}
        {event.schemasWalked > 0 && (
          <StatCell label="Schemas" value={event.schemasWalked} />
        )}
      </dl>
    </div>
  );
}

function StatCell({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className="rounded-md bg-slate-50 p-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`mt-0.5 text-lg font-semibold ${danger ? 'text-red-600' : 'text-slate-900'}`}>
        {value}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DiscoveredSourcesTable
// ---------------------------------------------------------------------------

/**
 * Lists source registrations discovered via the connector crawl.
 */
export function DiscoveredSourcesTable({
  sources,
  onCreateProduct,
}: {
  sources: SourceRegistration[] | null;
  onCreateProduct: (source: SourceRegistration) => void;
}) {
  if (sources === null) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Discovered sources</h2>
        <p className="text-sm text-slate-500">Loading sources…</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
      <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Discovered sources</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {sources.length === 0
              ? 'No sources registered yet — run a crawl to discover objects in the connected system.'
              : `${sources.length} source${sources.length === 1 ? '' : 's'} registered`}
          </p>
        </div>
      </div>

      {sources.length === 0 ? (
        <div className="p-5 text-sm text-slate-500">
          Run a discovery crawl from the Re-crawl button above to populate this list.
        </div>
      ) : (
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <Th>Source ref</Th>
              <Th>Type</Th>
              <Th>Display name</Th>
              <Th>Description</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {sources.map((s) => (
              <tr key={s.id}>
                <Td>
                  <span className="font-mono text-xs text-slate-700">{s.sourceRef}</span>
                </Td>
                <Td>
                  <span className="text-xs uppercase tracking-wide text-slate-500">{s.sourceType}</span>
                </Td>
                <Td>
                  <span className="font-medium text-slate-900">{s.displayName}</span>
                </Td>
                <Td>
                  {s.description ? (
                    <span className="text-slate-500 line-clamp-2">{s.description}</span>
                  ) : (
                    <span className="text-slate-300 italic">none</span>
                  )}
                </Td>
                <Td>
                  {/*
                   * B-075 Tier A: deep-links into product authoring carrying
                   * this source's identity through router state (see
                   * handleCreateProduct → SourceBindingNavState). NewProductForm
                   * creates the product shell, then forwards the source into
                   * ProductDetail where the port form opens with the binding
                   * pre-selected.
                   *
                   * Surface 2 seam (still open): the producer must still pick a
                   * port interface type and hand-author the Contract Schema JSON
                   * even though the schema was already discovered. Auto-defaulting
                   * the contract schema from the source snapshot is the publish-
                   * gate work tracked under B-075 Surface 2, not this slice.
                   */}
                  <button
                    type="button"
                    onClick={() => onCreateProduct(s)}
                    className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                  >
                    Create data product
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table helpers (mirrors ConnectorsPage)
// ---------------------------------------------------------------------------

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 text-sm text-slate-700 align-top">{children}</td>;
}
