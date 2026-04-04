import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { productsApi } from '../../shared/api/products.js';
import { organizationsApi } from '../../shared/api/organizations.js';
import { accessApi } from '../../shared/api/access.js';
import { ApiError } from '../../shared/api/client.js';
import type {
  DataProduct,
  Domain,
  Port,
  PortType,
  OutputPortInterfaceType,
  ProductVersion,
  ComplianceViolation,
  ComplianceState,
  ComplianceStateValue,
  DeclarePortRequest,
  SubmitAccessRequestRequest,
} from '@provenance/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  published: 'bg-green-100 text-green-800 border-green-200',
  deprecated: 'bg-orange-100 text-orange-800 border-orange-200',
  decommissioned: 'bg-red-100 text-red-800 border-red-200',
};

const CLASSIFICATION_STYLES: Record<string, string> = {
  public: 'bg-blue-100 text-blue-800',
  internal: 'bg-slate-100 text-slate-700',
  confidential: 'bg-amber-100 text-amber-800',
  restricted: 'bg-red-100 text-red-800',
};

const COMPLIANCE_STYLES: Record<ComplianceStateValue, string> = {
  compliant:      'bg-green-100 text-green-800 border-green-200',
  drift_detected: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  grace_period:   'bg-orange-100 text-orange-800 border-orange-200',
  non_compliant:  'bg-red-100 text-red-800 border-red-200',
};

const COMPLIANCE_LABELS: Record<ComplianceStateValue, string> = {
  compliant:      'Compliant',
  drift_detected: 'Drift Detected',
  grace_period:   'Grace Period',
  non_compliant:  'Non-Compliant',
};

const PORT_TYPE_LABELS: Record<PortType, string> = {
  input: 'Input',
  output: 'Output',
  discovery: 'Discovery',
  observability: 'Observability',
  control: 'Control',
};

const PORT_TYPE_COLORS: Record<PortType, string> = {
  output:       'bg-blue-100 text-blue-800',
  input:        'bg-gray-100 text-gray-700',
  discovery:    'bg-green-100 text-green-800',
  observability:'bg-amber-100 text-amber-800',
  control:      'bg-purple-100 text-purple-800',
};

const INTERFACE_TYPE_OPTIONS: { value: OutputPortInterfaceType; label: string }[] = [
  { value: 'sql_jdbc',                label: 'SQL / JDBC' },
  { value: 'rest_api',                label: 'REST API' },
  { value: 'graphql',                 label: 'GraphQL' },
  { value: 'streaming_topic',         label: 'Streaming Topic' },
  { value: 'file_object_export',      label: 'File / Object Export' },
  { value: 'semantic_query_endpoint', label: 'Semantic Query (Agents)' },
];

const PORT_TYPE_OPTIONS: { value: PortType; label: string }[] = [
  { value: 'output',       label: 'Output' },
  { value: 'discovery',    label: 'Discovery' },
  { value: 'input',        label: 'Input' },
  { value: 'observability', label: 'Observability' },
  { value: 'control',      label: 'Control' },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChecklistItem {
  id: string;
  label: string;
  pass: boolean;
}

// ---------------------------------------------------------------------------
// ProductDetail
// ---------------------------------------------------------------------------

export function ProductDetail() {
  const { orgId, domainId, productId } =
    useParams<{ orgId: string; domainId: string; productId: string }>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [product, setProduct] = useState<DataProduct | null>(null);
  const [domain, setDomain] = useState<Domain | null>(null);
  const [versions, setVersions] = useState<ProductVersion[]>([]);
  const [complianceState, setComplianceState] = useState<ComplianceState | null>(null);
  const [trustScore, setTrustScore] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const load = useCallback(async () => {
    if (!orgId || !domainId || !productId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [p, d, v] = await Promise.all([
        productsApi.get(orgId, domainId, productId),
        organizationsApi.domains.get(orgId, domainId),
        productsApi.versions.list(orgId, domainId, productId),
      ]);
      setProduct(p);
      setDomain(d);
      setVersions(v.items);

      // Supplementary data — silently ignore 404s (expected for draft products)
      const [complianceResult, trustResult] = await Promise.allSettled([
        productsApi.compliance(orgId, domainId, productId),
        productsApi.trustScore(orgId, domainId, productId),
      ]);
      if (complianceResult.status === 'fulfilled') setComplianceState(complianceResult.value);
      if (trustResult.status === 'fulfilled') setTrustScore(trustResult.value.score);
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [orgId, domainId, productId]);

  useEffect(() => { void load(); }, [load]);

  // Auto-dismiss toast after 4 s
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);


  const checklist: ChecklistItem[] = product
    ? [
        {
          id: 'has_output_port',
          label: 'At least one output port declared',
          pass: product.ports.some((p) => p.portType === 'output'),
        },
        {
          id: 'has_discovery_port',
          label: 'At least one discovery port declared',
          pass: product.ports.some((p) => p.portType === 'discovery'),
        },
        {
          id: 'has_name_and_classification',
          label: 'Name and classification set',
          pass: true,
        },
      ]
    : [];

  const allChecksPassed = checklist.length > 0 && checklist.every((c) => c.pass);

  const handlePortAdded = async () => {
    if (!orgId || !domainId || !productId) return;
    const updated = await productsApi.get(orgId, domainId, productId);
    setProduct(updated);
  };

  const handlePortDeleted = async () => {
    if (!orgId || !domainId || !productId) return;
    const updated = await productsApi.get(orgId, domainId, productId);
    setProduct(updated);
  };

  const handlePublished = async (updated: DataProduct) => {
    setProduct(updated);
    const [versionsResult, complianceResult, trustResult] = await Promise.allSettled([
      productsApi.versions.list(orgId!, domainId!, productId!),
      productsApi.compliance(orgId!, domainId!, productId!),
      productsApi.trustScore(orgId!, domainId!, productId!),
    ]);
    if (versionsResult.status === 'fulfilled') setVersions(versionsResult.value.items);
    if (complianceResult.status === 'fulfilled') setComplianceState(complianceResult.value);
    if (trustResult.status === 'fulfilled') setTrustScore(trustResult.value.score);
    setToast({ type: 'success', message: 'Product published successfully' });
  };

  if (loading) return <PageShell><Spinner /></PageShell>;
  if (loadError || !product) {
    return (
      <PageShell>
        <ErrorBanner message={loadError ?? 'Product not found'} onRetry={() => void load()} />
      </PageShell>
    );
  }

  return (
    <PageShell>
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-slate-500 mb-6">
        <Link
          to={`/dashboard/${orgId}/domains/${domainId}`}
          className="hover:text-brand-600 transition-colors"
        >
          {domain?.name ?? 'Domain'}
        </Link>
        <span>/</span>
        <span className="text-slate-900 font-medium">{product.name}</span>
      </nav>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold text-slate-900">{product.name}</h1>
          <StatusBadge status={product.status} />
          <ClassificationBadge classification={product.classification} />
          {complianceState && <ComplianceBadge state={complianceState.state} />}
          {trustScore !== null && <TrustScoreBadge score={trustScore} />}
        </div>
        <p className="mt-1 text-sm text-slate-400 font-mono">
          {product.slug} · v{product.version}
        </p>
        {product.description && (
          <p className="mt-2 text-sm text-slate-600 max-w-2xl">{product.description}</p>
        )}
        {product.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {product.tags.map((tag) => (
              <span
                key={tag}
                className="inline-block px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Publish panel — only when draft */}
      {product.status === 'draft' && (
        <PublishPanel
          product={product}
          orgId={orgId!}
          domainId={domainId!}
          checklist={checklist}
          allChecksPassed={allChecksPassed}
          onPublished={(updated) => void handlePublished(updated)}
          onNetworkError={() =>
            setToast({ type: 'error', message: 'Network error — could not reach the server' })
          }
        />
      )}

      {/* Request access — only for published products */}
      {product.status === 'published' && (
        <RequestAccessPanel product={product} orgId={orgId!} />
      )}

      {/* Ports */}
      <section className="mb-8">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Port Declarations</h2>
        <PortSection
          product={product}
          orgId={orgId!}
          domainId={domainId!}
          isOwner={product.status === 'draft'}
          onPortAdded={() => void handlePortAdded()}
          onPortDeleted={() => void handlePortDeleted()}
        />
      </section>

      {/* Version history */}
      <section>
        <h2 className="text-base font-semibold text-slate-900 mb-4">Version History</h2>
        <VersionHistorySection versions={versions} />
      </section>

      {/* Toast */}
      {toast && (
        <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
      )}
    </PageShell>
  );
}

// ---------------------------------------------------------------------------
// StatusBadge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
        STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700 border-slate-200'
      }`}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ClassificationBadge
// ---------------------------------------------------------------------------

function ClassificationBadge({ classification }: { classification: string }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
        CLASSIFICATION_STYLES[classification] ?? 'bg-slate-100 text-slate-700'
      }`}
    >
      {classification}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ComplianceBadge
// ---------------------------------------------------------------------------

function ComplianceBadge({ state }: { state: ComplianceStateValue }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
        COMPLIANCE_STYLES[state] ?? 'bg-slate-100 text-slate-700 border-slate-200'
      }`}
    >
      {COMPLIANCE_LABELS[state] ?? state}
    </span>
  );
}

// ---------------------------------------------------------------------------
// TrustScoreBadge
// ---------------------------------------------------------------------------

function TrustScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80 ? 'bg-green-100 text-green-800' :
    score >= 60 ? 'bg-yellow-100 text-yellow-800' :
                  'bg-red-100 text-red-800';
  return (
    <span className={`inline-flex items-center gap-0.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${color}`}>
      <span className="font-mono">{score}</span>
      <span className="opacity-60">/100</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// RequestAccessPanel
// ---------------------------------------------------------------------------

interface RequestAccessPanelProps {
  product: DataProduct;
  orgId: string;
}

function RequestAccessPanel({ product, orgId }: RequestAccessPanelProps) {
  const [showForm, setShowForm] = useState(false);
  const [justification, setJustification] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    const dto: SubmitAccessRequestRequest = { productId: product.id };
    if (justification.trim()) dto.justification = justification.trim();
    try {
      await accessApi.requests.submit(orgId, dto);
      setSuccess(true);
      setShowForm(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="mb-8 rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-800">
        Access request submitted. The data product owner will review your request.
      </div>
    );
  }

  if (!showForm) {
    return (
      <div className="mb-8">
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 rounded-md border border-brand-300 text-brand-700 text-sm font-medium hover:bg-brand-50 transition-colors"
        >
          Request Access
        </button>
      </div>
    );
  }

  return (
    <div className="mb-8 rounded-lg border border-slate-200 bg-slate-50 p-5">
      <h2 className="text-base font-semibold text-slate-900 mb-3">Request access</h2>
      <div className="mb-3">
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Justification <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <textarea
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          className="input min-h-[80px] resize-y"
          placeholder="Describe how you intend to use this data product…"
          disabled={submitting}
        />
      </div>
      {error && (
        <div className="mb-3 rounded-md bg-red-50 border border-red-200 p-2 text-xs text-red-700">
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => void handleSubmit()}
          disabled={submitting}
          className="px-4 py-2 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {submitting ? 'Submitting…' : 'Submit request'}
        </button>
        <button
          type="button"
          onClick={() => { setShowForm(false); setError(null); }}
          className="px-4 py-2 rounded-md border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PublishPanel
// ---------------------------------------------------------------------------

interface PublishPanelProps {
  product: DataProduct;
  orgId: string;
  domainId: string;
  checklist: ChecklistItem[];
  allChecksPassed: boolean;
  onPublished: (updated: DataProduct) => void;
  onNetworkError: () => void;
}

function PublishPanel({
  product,
  orgId,
  domainId,
  checklist,
  allChecksPassed,
  onPublished,
  onNetworkError,
}: PublishPanelProps) {
  const [publishing, setPublishing] = useState(false);
  const [changeDescription, setChangeDescription] = useState('');
  const [publishError, setPublishError] = useState<string | null>(null);
  const [violations, setViolations] = useState<ComplianceViolation[]>([]);

  const handlePublish = async () => {
    setPublishing(true);
    setPublishError(null);
    setViolations([]);
    try {
      const trimmed = changeDescription.trim();
      const updated = await productsApi.publish(orgId, domainId, product.id, {
        changeDescription: trimmed !== '' ? trimmed : 'Initial publication',
      });
      onPublished(updated);
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { message?: string; violations?: ComplianceViolation[] };
        if (body.violations && body.violations.length > 0) {
          setViolations(body.violations);
          setPublishError(body.message ?? 'Governance policy violations prevent publication');
        } else {
          setPublishError(body.message ?? err.message);
        }
      } else {
        onNetworkError();
      }
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="mb-8 rounded-lg border border-slate-200 bg-slate-50 p-5">
      <h2 className="text-base font-semibold text-slate-900 mb-4">Ready to publish?</h2>

      {/* Pre-publish checklist */}
      <div className="mb-5">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
          Pre-publish checklist
        </p>
        <ul className="space-y-1.5">
          {checklist.map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-sm">
              {item.pass ? (
                <CheckIcon className="text-green-500 flex-shrink-0" />
              ) : (
                <XIcon className="text-red-400 flex-shrink-0" />
              )}
              <span className={item.pass ? 'text-slate-600' : 'text-slate-900 font-medium'}>
                {item.label}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Change description */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Change description{' '}
          <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <textarea
          value={changeDescription}
          onChange={(e) => setChangeDescription(e.target.value)}
          className="input min-h-[64px] resize-y"
          placeholder="Describe what's in this version…"
          disabled={publishing}
        />
      </div>

      {/* Inline validation / conflict error */}
      {publishError && violations.length === 0 && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {publishError}
        </div>
      )}

      {/* Governance violation details */}
      {violations.length > 0 && (
        <div className="mb-4">
          <p className="text-sm font-medium text-red-700 mb-2">{publishError}</p>
          <ViolationList violations={violations} />
        </div>
      )}

      {/* Publish button */}
      <button
        onClick={() => void handlePublish()}
        disabled={publishing || !allChecksPassed}
        className="px-4 py-2 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {publishing ? 'Publishing…' : 'Publish Data Product'}
      </button>

      {!allChecksPassed && (
        <p className="mt-2 text-xs text-slate-500">
          Complete all checklist items above before publishing.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ViolationList
// ---------------------------------------------------------------------------

function ViolationList({ violations }: { violations: ComplianceViolation[] }) {
  return (
    <ul className="space-y-2">
      {violations.map((v, i) => (
        <li key={i} className="rounded-md bg-red-50 border border-red-200 p-3 text-sm">
          <div className="flex items-start gap-2">
            <XIcon className="text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-medium text-red-800">{v.ruleId}</span>
              <span className="mx-1.5 text-red-300">·</span>
              <span className="text-xs text-red-500 uppercase tracking-wide">
                {v.policyDomain}
              </span>
              <p className="mt-0.5 text-red-700">{v.detail}</p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// PortSection
// ---------------------------------------------------------------------------

interface PortSectionProps {
  product: DataProduct;
  orgId: string;
  domainId: string;
  isOwner: boolean;
  onPortAdded: () => void;
  onPortDeleted: () => void;
}

function PortSection({
  product,
  orgId,
  domainId,
  isOwner,
  onPortAdded,
  onPortDeleted,
}: PortSectionProps) {
  const [showForm, setShowForm] = useState(false);
  const ports = product.ports ?? [];

  return (
    <div>
      {ports.length === 0 ? (
        <p className="text-sm text-slate-500 mb-4">No ports declared yet.</p>
      ) : (
        <div className="space-y-3 mb-4">
          {ports.map((port) => (
            <PortCard
              key={port.id}
              port={port}
              orgId={orgId}
              domainId={domainId}
              productId={product.id}
              isOwner={isOwner}
              onDeleted={onPortDeleted}
            />
          ))}
        </div>
      )}

      {isOwner && (
        showForm ? (
          <AddPortForm
            orgId={orgId}
            domainId={domainId}
            productId={product.id}
            onAdded={() => { setShowForm(false); onPortAdded(); }}
            onCancel={() => setShowForm(false)}
          />
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-dashed border-slate-300 text-sm text-slate-600 hover:border-brand-500 hover:text-brand-600 transition-colors"
          >
            <span className="text-base leading-none">+</span> Add port
          </button>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PortCard
// ---------------------------------------------------------------------------

interface PortCardProps {
  port: Port;
  orgId: string;
  domainId: string;
  productId: string;
  isOwner: boolean;
  onDeleted: () => void;
}

function PortCard({ port, orgId, domainId, productId, isOwner, onDeleted }: PortCardProps) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!window.confirm(`Delete port "${port.name}"?`)) return;
    setDeleting(true);
    try {
      await productsApi.ports.delete(orgId, domainId, productId, port.id);
      onDeleted();
    } catch {
      setDeleting(false);
    }
  };

  return (
    <div className="flex items-start gap-4 p-4 bg-white rounded-lg border border-slate-200">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm text-slate-900">{port.name}</span>
          <span
            className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${PORT_TYPE_COLORS[port.portType]}`}
          >
            {PORT_TYPE_LABELS[port.portType]}
          </span>
          {port.interfaceType && (
            <span className="text-xs text-slate-400">
              {INTERFACE_TYPE_OPTIONS.find((o) => o.value === port.interfaceType)?.label ??
                port.interfaceType}
            </span>
          )}
        </div>

        {port.description && (
          <p className="mt-1 text-xs text-slate-500">{port.description}</p>
        )}

        {port.contractSchema && (
          <details className="mt-2">
            <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 select-none">
              Contract schema
            </summary>
            <pre className="mt-1 text-xs bg-slate-50 rounded p-2 overflow-auto max-h-40 text-slate-700 border border-slate-100">
              {JSON.stringify(port.contractSchema, null, 2)}
            </pre>
          </details>
        )}

        {port.slaDescription && (
          <p className="mt-1.5 text-xs text-slate-400">SLA: {port.slaDescription}</p>
        )}
      </div>

      {isOwner && (
        <button
          onClick={() => void handleDelete()}
          disabled={deleting}
          className="flex-shrink-0 text-xs text-slate-400 hover:text-red-500 disabled:opacity-50 transition-colors pt-0.5"
        >
          {deleting ? '…' : 'Remove'}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddPortForm
// ---------------------------------------------------------------------------

interface AddPortFormProps {
  orgId: string;
  domainId: string;
  productId: string;
  onAdded: () => void;
  onCancel: () => void;
}

function AddPortForm({ orgId, domainId, productId, onAdded, onCancel }: AddPortFormProps) {
  const [portType, setPortType] = useState<PortType>('output');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [interfaceType, setInterfaceType] = useState<OutputPortInterfaceType | ''>('');
  const [contractSchemaRaw, setContractSchemaRaw] = useState('');
  const [slaDescription, setSlaDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let contractSchema: Record<string, unknown> | undefined;
    if (contractSchemaRaw.trim()) {
      try {
        contractSchema = JSON.parse(contractSchemaRaw) as Record<string, unknown>;
      } catch {
        setError('Must be valid JSON');
        return;
      }
    }

    const dto: DeclarePortRequest = {
      portType,
      name,
      ...(description.trim() !== '' ? { description: description.trim() } : {}),
      ...(portType === 'output' && interfaceType ? { interfaceType } : {}),
      ...(contractSchema !== undefined ? { contractSchema } : {}),
      ...(slaDescription.trim() !== '' ? { slaDescription: slaDescription.trim() } : {}),
    };

    setSaving(true);
    try {
      await productsApi.ports.declare(orgId, domainId, productId, dto);
      onAdded();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-brand-100 bg-brand-50 p-4">
      <h3 className="text-sm font-medium text-slate-900 mb-3">Add port</h3>
      <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Port type" required>
            <select
              value={portType}
              onChange={(e) => setPortType(e.target.value as PortType)}
              className="input"
            >
              {PORT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Name" required>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              required
              placeholder="e.g. Customer output"
            />
          </Field>
        </div>

        <Field label="Description">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input"
            placeholder="Optional short description"
          />
        </Field>

        {portType === 'output' && (
          <>
            <Field label="Interface type">
              <select
                value={interfaceType}
                onChange={(e) =>
                  setInterfaceType(e.target.value as OutputPortInterfaceType | '')
                }
                className="input"
              >
                <option value="">— select —</option>
                {INTERFACE_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>

            <Field label="Contract Schema (JSON)" required>
              <textarea
                value={contractSchemaRaw}
                onChange={(e) => setContractSchemaRaw(e.target.value)}
                rows={4}
                className="input font-mono text-xs resize-y"
                placeholder='{"columns": [{"name": "customer_id", "type": "string"}]}'
              />
            </Field>
          </>
        )}

        <Field label="SLA description">
          <input
            type="text"
            value={slaDescription}
            onChange={(e) => setSlaDescription(e.target.value)}
            className="input"
            placeholder="e.g. 99.9% uptime, refreshed daily at 02:00 UTC"
          />
        </Field>

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 p-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="px-3 py-1.5 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Adding…' : 'Add port'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VersionHistorySection
// ---------------------------------------------------------------------------

function VersionHistorySection({ versions }: { versions: ProductVersion[] }) {
  if (versions.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No published versions yet. Publish the product to create the first version snapshot.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {versions.map((v) => (
        <div
          key={v.id}
          className="flex items-start gap-4 p-4 bg-white rounded-lg border border-slate-200"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <span className="font-medium text-sm text-slate-900 font-mono">v{v.version}</span>
              <span className="text-xs text-slate-400">
                {new Date(v.createdAt).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </div>
            {v.changeDescription && (
              <p className="mt-0.5 text-sm text-slate-600">{v.changeDescription}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

function Toast({
  message,
  type,
  onDismiss,
}: {
  message: string;
  type: 'success' | 'error';
  onDismiss: () => void;
}) {
  return (
    <div
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
        type === 'success' ? 'bg-green-700 text-white' : 'bg-red-700 text-white'
      }`}
    >
      <span>{message}</span>
      <button
        onClick={onDismiss}
        className="opacity-70 hover:opacity-100 transition-opacity text-lg leading-none"
      >
        ×
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function Field({
  label,
  children,
  required,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="p-8 max-w-4xl mx-auto">{children}</div>;
}

function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
    </div>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-md bg-red-50 border border-red-200 p-4">
      <p className="text-sm text-red-700">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 text-sm text-red-700 underline font-medium hover:no-underline"
        >
          Try again
        </button>
      )}
    </div>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={`h-4 w-4 ${className ?? ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      className={`h-4 w-4 ${className ?? ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
