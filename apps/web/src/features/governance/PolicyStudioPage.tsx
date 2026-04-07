import { useState, useEffect } from 'react';
import { governanceApi } from '../../shared/api/governance.js';
import { ApiError } from '../../shared/api/client.js';
import { useAuth } from '../../auth/AuthProvider.js';
import type {
  PolicyDomain,
  PolicyImpactPreview,
  EffectivePolicy,
} from '@provenance/types';

// ---------------------------------------------------------------------------
// Domain configuration
// ---------------------------------------------------------------------------

const POLICY_DOMAINS: { key: PolicyDomain; label: string }[] = [
  { key: 'product_schema', label: 'Schema Compliance' },
  { key: 'classification_taxonomy', label: 'Data Classification' },
  { key: 'versioning_deprecation', label: 'Versioning Policy' },
  { key: 'access_control', label: 'Access Control' },
  { key: 'lineage', label: 'Lineage Completeness' },
  { key: 'slo', label: 'SLO Requirements' },
  { key: 'agent_access', label: 'Agent Access' },
  { key: 'interoperability', label: 'Interoperability' },
];

// ---------------------------------------------------------------------------
// Default rules per domain
// ---------------------------------------------------------------------------

const DOMAIN_DEFAULTS: Record<PolicyDomain, Record<string, unknown>> = {
  product_schema: {
    requireDescription: false,
    minDescriptionLength: 0,
    requireOutputPort: true,
    requireDiscoveryPort: true,
    requireContractSchema: true,
  },
  classification_taxonomy: {
    classificationRequired: true,
    allowedClassifications: ['public', 'internal', 'confidential', 'restricted'],
    piiDeclarationRequired: false,
  },
  versioning_deprecation: {
    semanticVersioningRequired: true,
    breakingChangeNotificationDays: 14,
    minDeprecationNoticeDays: 30,
    maxActiveVersions: 3,
  },
  access_control: {
    defaultAccessPolicy: 'request_required',
    maxGrantDurationDays: 365,
    accessReviewRequired: false,
    accessReviewFrequencyDays: 90,
  },
  lineage: {
    minLineageDepth: 1,
    allInputPortsMustHaveLineage: false,
    lineageFreshnessRequirement: 'none',
  },
  slo: {
    minSlosRequired: 0,
    availabilitySloRequired: false,
    freshnessSloRequired: false,
    minSloTargetFloor: 0,
  },
  agent_access: {
    agentAccessAllowed: true,
    minTrustClassification: 'observed',
    provenanceEnvelopeRequired: false,
  },
  interoperability: {
    requireSemanticAnnotations: false,
    requireStandardPortNaming: false,
    crossDomainAccessAllowed: true,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function cloneRules(r: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(r)) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Toggle component
// ---------------------------------------------------------------------------

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between py-2">
      <span className="text-sm text-slate-700">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 ${
          checked ? 'bg-brand-600' : 'bg-slate-300'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Number input component
// ---------------------------------------------------------------------------

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="py-2">
      <label className="block text-sm text-slate-700 mb-1">{label}</label>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Select component
// ---------------------------------------------------------------------------

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | number;
  options: { value: string | number; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="py-2">
      <label className="block text-sm text-slate-700 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slider component
// ---------------------------------------------------------------------------

function SliderField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="py-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-slate-700">{label}</span>
        <span className="text-sm font-medium text-slate-900">{value}%</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-full accent-brand-600"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-select checkboxes
// ---------------------------------------------------------------------------

function MultiCheckbox({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  function toggle(opt: string) {
    if (selected.includes(opt)) {
      onChange(selected.filter((s) => s !== opt));
    } else {
      onChange([...selected, opt]);
    }
  }

  return (
    <fieldset className="py-2">
      <legend className="text-sm text-slate-700 mb-1">{label}</legend>
      <div className="space-y-1 border border-slate-200 rounded-lg p-3 bg-slate-50">
        {options.map((opt) => (
          <label key={opt} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(opt)}
              onChange={() => toggle(opt)}
              className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-sm text-slate-700 capitalize">{opt.replace(/_/g, ' ')}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Domain rule panels
// ---------------------------------------------------------------------------

type RuleUpdater = (patch: Partial<Record<string, unknown>>) => void;

function SchemaCompliancePanel({
  rules,
  onUpdate,
}: {
  rules: Record<string, unknown>;
  onUpdate: RuleUpdater;
}) {
  return (
    <div className="space-y-1">
      <Toggle
        label="Require description"
        checked={rules.requireDescription as boolean}
        onChange={(v) => onUpdate({ requireDescription: v })}
      />
      <NumberField
        label="Minimum description length"
        value={rules.minDescriptionLength as number}
        min={0}
        max={500}
        onChange={(v) => onUpdate({ minDescriptionLength: v })}
      />
      <Toggle
        label="Require output port"
        checked={rules.requireOutputPort as boolean}
        onChange={(v) => onUpdate({ requireOutputPort: v })}
      />
      <Toggle
        label="Require discovery port"
        checked={rules.requireDiscoveryPort as boolean}
        onChange={(v) => onUpdate({ requireDiscoveryPort: v })}
      />
      <Toggle
        label="Require contract schema"
        checked={rules.requireContractSchema as boolean}
        onChange={(v) => onUpdate({ requireContractSchema: v })}
      />
    </div>
  );
}

function DataClassificationPanel({
  rules,
  onUpdate,
}: {
  rules: Record<string, unknown>;
  onUpdate: RuleUpdater;
}) {
  return (
    <div className="space-y-1">
      <Toggle
        label="Classification required"
        checked={rules.classificationRequired as boolean}
        onChange={(v) => onUpdate({ classificationRequired: v })}
      />
      <MultiCheckbox
        label="Allowed classifications"
        options={['public', 'internal', 'confidential', 'restricted']}
        selected={rules.allowedClassifications as string[]}
        onChange={(v) => onUpdate({ allowedClassifications: v })}
      />
      <Toggle
        label="PII declaration required"
        checked={rules.piiDeclarationRequired as boolean}
        onChange={(v) => onUpdate({ piiDeclarationRequired: v })}
      />
    </div>
  );
}

function VersioningPolicyPanel({
  rules,
  onUpdate,
}: {
  rules: Record<string, unknown>;
  onUpdate: RuleUpdater;
}) {
  return (
    <div className="space-y-1">
      <Toggle
        label="Semantic versioning required"
        checked={rules.semanticVersioningRequired as boolean}
        onChange={(v) => onUpdate({ semanticVersioningRequired: v })}
      />
      <NumberField
        label="Breaking change notification days"
        value={rules.breakingChangeNotificationDays as number}
        min={0}
        max={90}
        onChange={(v) => onUpdate({ breakingChangeNotificationDays: v })}
      />
      <NumberField
        label="Minimum deprecation notice days"
        value={rules.minDeprecationNoticeDays as number}
        min={0}
        max={365}
        onChange={(v) => onUpdate({ minDeprecationNoticeDays: v })}
      />
      <NumberField
        label="Max active versions"
        value={rules.maxActiveVersions as number}
        min={1}
        max={10}
        onChange={(v) => onUpdate({ maxActiveVersions: v })}
      />
    </div>
  );
}

function AccessControlPanel({
  rules,
  onUpdate,
}: {
  rules: Record<string, unknown>;
  onUpdate: RuleUpdater;
}) {
  return (
    <div className="space-y-1">
      <SelectField
        label="Default access policy"
        value={rules.defaultAccessPolicy as string}
        options={[
          { value: 'open', label: 'Open' },
          { value: 'request_required', label: 'Request Required' },
          { value: 'restricted', label: 'Restricted' },
        ]}
        onChange={(v) => onUpdate({ defaultAccessPolicy: v })}
      />
      <SelectField
        label="Max grant duration"
        value={String(rules.maxGrantDurationDays)}
        options={[
          { value: '30', label: '30 days' },
          { value: '90', label: '90 days' },
          { value: '180', label: '180 days' },
          { value: '365', label: '365 days' },
          { value: 'unlimited', label: 'Unlimited' },
        ]}
        onChange={(v) =>
          onUpdate({ maxGrantDurationDays: v === 'unlimited' ? 'unlimited' : parseInt(v, 10) })
        }
      />
      <Toggle
        label="Access review required"
        checked={rules.accessReviewRequired as boolean}
        onChange={(v) => onUpdate({ accessReviewRequired: v })}
      />
      {rules.accessReviewRequired && (
        <NumberField
          label="Access review frequency (days)"
          value={rules.accessReviewFrequencyDays as number}
          min={30}
          max={365}
          onChange={(v) => onUpdate({ accessReviewFrequencyDays: v })}
        />
      )}
    </div>
  );
}

function LineageCompletenessPanel({
  rules,
  onUpdate,
}: {
  rules: Record<string, unknown>;
  onUpdate: RuleUpdater;
}) {
  return (
    <div className="space-y-1">
      <NumberField
        label="Minimum lineage depth"
        value={rules.minLineageDepth as number}
        min={0}
        max={10}
        onChange={(v) => onUpdate({ minLineageDepth: v })}
      />
      <Toggle
        label="All input ports must have lineage"
        checked={rules.allInputPortsMustHaveLineage as boolean}
        onChange={(v) => onUpdate({ allInputPortsMustHaveLineage: v })}
      />
      <SelectField
        label="Lineage freshness requirement"
        value={rules.lineageFreshnessRequirement as string}
        options={[
          { value: 'none', label: 'None' },
          { value: 'weekly', label: 'Weekly' },
          { value: 'daily', label: 'Daily' },
        ]}
        onChange={(v) => onUpdate({ lineageFreshnessRequirement: v })}
      />
    </div>
  );
}

function SloRequirementsPanel({
  rules,
  onUpdate,
}: {
  rules: Record<string, unknown>;
  onUpdate: RuleUpdater;
}) {
  return (
    <div className="space-y-1">
      <NumberField
        label="Minimum SLOs required"
        value={rules.minSlosRequired as number}
        min={0}
        max={10}
        onChange={(v) => onUpdate({ minSlosRequired: v })}
      />
      <Toggle
        label="Availability SLO required"
        checked={rules.availabilitySloRequired as boolean}
        onChange={(v) => onUpdate({ availabilitySloRequired: v })}
      />
      <Toggle
        label="Freshness SLO required"
        checked={rules.freshnessSloRequired as boolean}
        onChange={(v) => onUpdate({ freshnessSloRequired: v })}
      />
      <SliderField
        label="Minimum SLO target floor"
        value={rules.minSloTargetFloor as number}
        min={0}
        max={100}
        onChange={(v) => onUpdate({ minSloTargetFloor: v })}
      />
    </div>
  );
}

function AgentAccessPanel({
  rules,
  onUpdate,
}: {
  rules: Record<string, unknown>;
  onUpdate: RuleUpdater;
}) {
  return (
    <div className="space-y-1">
      <Toggle
        label="Agent access allowed"
        checked={rules.agentAccessAllowed as boolean}
        onChange={(v) => onUpdate({ agentAccessAllowed: v })}
      />
      <SelectField
        label="Minimum trust classification"
        value={rules.minTrustClassification as string}
        options={[
          { value: 'observed', label: 'Observed' },
          { value: 'supervised', label: 'Supervised' },
          { value: 'autonomous', label: 'Autonomous' },
        ]}
        onChange={(v) => onUpdate({ minTrustClassification: v })}
      />
      <Toggle
        label="Provenance envelope required"
        checked={rules.provenanceEnvelopeRequired as boolean}
        onChange={(v) => onUpdate({ provenanceEnvelopeRequired: v })}
      />
    </div>
  );
}

function InteroperabilityPanel({
  rules,
  onUpdate,
}: {
  rules: Record<string, unknown>;
  onUpdate: RuleUpdater;
}) {
  return (
    <div className="space-y-1">
      <Toggle
        label="Require semantic annotations"
        checked={rules.requireSemanticAnnotations as boolean}
        onChange={(v) => onUpdate({ requireSemanticAnnotations: v })}
      />
      <Toggle
        label="Require standard port naming"
        checked={rules.requireStandardPortNaming as boolean}
        onChange={(v) => onUpdate({ requireStandardPortNaming: v })}
      />
      <Toggle
        label="Cross-domain access allowed"
        checked={rules.crossDomainAccessAllowed as boolean}
        onChange={(v) => onUpdate({ crossDomainAccessAllowed: v })}
      />
    </div>
  );
}

const DOMAIN_PANELS: Record<
  PolicyDomain,
  (props: { rules: Record<string, unknown>; onUpdate: RuleUpdater }) => JSX.Element
> = {
  product_schema: SchemaCompliancePanel,
  classification_taxonomy: DataClassificationPanel,
  versioning_deprecation: VersioningPolicyPanel,
  access_control: AccessControlPanel,
  lineage: LineageCompletenessPanel,
  slo: SloRequirementsPanel,
  agent_access: AgentAccessPanel,
  interoperability: InteroperabilityPanel,
};

// ---------------------------------------------------------------------------
// Impact preview slide-over
// ---------------------------------------------------------------------------

function ImpactPreviewSlideOver({
  preview,
  onClose,
}: {
  preview: PolicyImpactPreview;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const domainLabel =
    POLICY_DOMAINS.find((d) => d.key === preview.policyDomain)?.label ?? preview.policyDomain;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="impact-title"
        className="fixed right-0 top-0 h-full w-full max-w-lg bg-white shadow-xl z-50 flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 id="impact-title" className="text-base font-semibold text-slate-900">
              Impact Preview
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">{domainLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500 rounded"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-200 p-3 text-center">
              <p className="text-lg font-bold text-slate-900">{preview.totalProducts}</p>
              <p className="text-xs text-slate-500">Total Products</p>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-center">
              <p className="text-lg font-bold text-red-700">{preview.newViolationCount}</p>
              <p className="text-xs text-red-600">New Violations</p>
            </div>
            <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-center">
              <p className="text-lg font-bold text-green-700">{preview.resolvedViolationCount}</p>
              <p className="text-xs text-green-600">Resolved</p>
            </div>
          </div>

          {/* Impacted products */}
          {preview.impactedProducts.length === 0 ? (
            <p className="text-sm text-slate-400">No products impacted by this change.</p>
          ) : (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-700">
                Impacted Products ({preview.impactedProducts.length})
              </h3>
              {preview.impactedProducts.map((p) => (
                <div
                  key={p.productId}
                  className="border border-slate-200 rounded-lg p-3 bg-slate-50"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-800 truncate">{p.productName}</p>
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">
                        {p.currentState.replace(/_/g, ' ')}
                      </span>
                      <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      <span
                        className={`px-1.5 py-0.5 rounded ${
                          p.projectedState === 'compliant'
                            ? 'bg-green-100 text-green-700'
                            : p.projectedState === 'non_compliant'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-yellow-100 text-yellow-700'
                        }`}
                      >
                        {p.projectedState.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>
                  {p.violations.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {p.violations.map((v, i) => (
                        <li key={i} className="text-xs text-red-600">
                          {v.detail}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Confirmation modal
// ---------------------------------------------------------------------------

function ConfirmPublishModal({
  domains,
  allRules,
  savedRules,
  onConfirm,
  onCancel,
  publishing,
}: {
  domains: { key: PolicyDomain; label: string }[];
  allRules: Record<PolicyDomain, Record<string, unknown>>;
  savedRules: Record<PolicyDomain, Record<string, unknown>>;
  onConfirm: () => void;
  onCancel: () => void;
  publishing: boolean;
}) {
  const changedDomains = domains.filter((d) => !deepEqual(allRules[d.key], savedRules[d.key]));

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" aria-hidden onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
          <h2 className="text-lg font-semibold text-slate-900">Publish Policy Changes</h2>
          <p className="mt-2 text-sm text-slate-600">
            You are about to publish policy changes for{' '}
            <span className="font-medium">{changedDomains.length}</span> domain
            {changedDomains.length !== 1 ? 's' : ''}:
          </p>
          <ul className="mt-3 space-y-1">
            {changedDomains.map((d) => (
              <li key={d.key} className="flex items-center gap-2 text-sm text-slate-700">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                {d.label}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-slate-500">
            Published policies take effect immediately and will trigger re-evaluation of all products.
          </p>
          <div className="flex gap-3 mt-6">
            <button
              type="button"
              disabled={publishing}
              onClick={onConfirm}
              className="flex-1 bg-brand-600 text-white text-sm font-medium py-2.5 rounded-lg hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
            >
              {publishing ? 'Publishing...' : 'Confirm Publish'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 bg-white border border-slate-300 text-slate-700 text-sm font-medium py-2.5 rounded-lg hover:bg-slate-50 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export function PolicyStudioPage() {
  const { keycloak } = useAuth();
  const orgId = keycloak.tokenParsed?.provenance_org_id as string | undefined;

  const [activeDomain, setActiveDomain] = useState<PolicyDomain>('product_schema');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Working copy of rules (edited by the user)
  const [allRules, setAllRules] = useState<Record<PolicyDomain, Record<string, unknown>>>(
    () => {
      const init = {} as Record<PolicyDomain, Record<string, unknown>>;
      for (const d of POLICY_DOMAINS) {
        init[d.key] = cloneRules(DOMAIN_DEFAULTS[d.key]);
      }
      return init;
    },
  );

  // Saved snapshot (what is currently on the server)
  const [savedRules, setSavedRules] = useState<Record<PolicyDomain, Record<string, unknown>>>(
    () => {
      const init = {} as Record<PolicyDomain, Record<string, unknown>>;
      for (const d of POLICY_DOMAINS) {
        init[d.key] = cloneRules(DOMAIN_DEFAULTS[d.key]);
      }
      return init;
    },
  );

  // Impact preview state
  const [previewData, setPreviewData] = useState<PolicyImpactPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Publish state
  const [showConfirm, setShowConfirm] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishSuccess, setPublishSuccess] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Load effective policies on mount
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!orgId) return;

    governanceApi.policies
      .listEffective(orgId)
      .then((list) => {
        const nextRules = {} as Record<PolicyDomain, Record<string, unknown>>;
        const nextSaved = {} as Record<PolicyDomain, Record<string, unknown>>;

        for (const d of POLICY_DOMAINS) {
          const existing = (list.items as EffectivePolicy[]).find(
            (ep) => ep.policyDomain === d.key,
          );
          const rules = existing
            ? cloneRules(existing.computedRules)
            : cloneRules(DOMAIN_DEFAULTS[d.key]);
          nextRules[d.key] = rules;
          nextSaved[d.key] = cloneRules(rules);
        }

        setAllRules(nextRules);
        setSavedRules(nextSaved);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Failed to load effective policies');
        setLoading(false);
      });
  }, [orgId]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  function updateDomainRules(domain: PolicyDomain, patch: Partial<Record<string, unknown>>) {
    setAllRules((prev) => ({
      ...prev,
      [domain]: { ...prev[domain], ...patch },
    }));
    // Clear success message on any edit
    setPublishSuccess(null);
  }

  function restoreDomain(domain: PolicyDomain) {
    setAllRules((prev) => ({
      ...prev,
      [domain]: cloneRules(savedRules[domain]),
    }));
  }

  function hasDomainChanges(domain: PolicyDomain): boolean {
    return !deepEqual(allRules[domain], savedRules[domain]);
  }

  function hasAnyChanges(): boolean {
    return POLICY_DOMAINS.some((d) => hasDomainChanges(d.key));
  }

  async function handlePreview(domain: PolicyDomain) {
    if (!orgId) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewData(null);

    try {
      const result = await governanceApi.policies.preview(orgId, {
        policyDomain: domain,
        rules: allRules[domain],
      });
      setPreviewData(result);
    } catch (err) {
      setPreviewError(err instanceof ApiError ? err.message : 'Failed to generate preview');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handlePublish() {
    if (!orgId) return;
    setPublishing(true);
    setPublishError(null);

    const changedDomains = POLICY_DOMAINS.filter((d) => hasDomainChanges(d.key));

    try {
      for (const d of changedDomains) {
        await governanceApi.policies.publish(orgId, {
          policyDomain: d.key,
          rules: allRules[d.key],
        });
      }

      // Update saved snapshot
      const nextSaved = {} as Record<PolicyDomain, Record<string, unknown>>;
      for (const d of POLICY_DOMAINS) {
        nextSaved[d.key] = cloneRules(allRules[d.key]);
      }
      setSavedRules(nextSaved);
      setShowConfirm(false);
      setPublishSuccess(
        `Successfully published ${changedDomains.length} policy domain${changedDomains.length !== 1 ? 's' : ''}.`,
      );
    } catch (err) {
      setPublishError(err instanceof ApiError ? err.message : 'Failed to publish policies');
    } finally {
      setPublishing(false);
    }
  }

  // -------------------------------------------------------------------------
  // Loading / error states
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="p-6 max-w-screen-xl mx-auto">
        <h1 className="text-2xl font-semibold text-slate-900 mb-6">Policy Studio</h1>
        <div className="flex gap-6">
          <div className="w-64 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />
            ))}
          </div>
          <div className="flex-1 h-96 bg-slate-100 rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-screen-xl mx-auto">
        <h1 className="text-2xl font-semibold text-slate-900 mb-6">Policy Studio</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const Panel = DOMAIN_PANELS[activeDomain];
  const activeDomainLabel =
    POLICY_DOMAINS.find((d) => d.key === activeDomain)?.label ?? activeDomain;

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Policy Studio</h1>
          <p className="mt-1 text-sm text-slate-500">
            Author and publish governance policies across all domains.
          </p>
        </div>
        <button
          type="button"
          disabled={!hasAnyChanges()}
          onClick={() => {
            setPublishError(null);
            setShowConfirm(true);
          }}
          className="px-5 py-2.5 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
        >
          Publish Policy
        </button>
      </div>

      {/* Success / error banners */}
      {publishSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">
          {publishSuccess}
        </div>
      )}
      {publishError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {publishError}
        </div>
      )}

      {/* Main layout */}
      <div className="flex gap-6">
        {/* Sidebar */}
        <nav className="w-64 flex-shrink-0 space-y-1">
          {POLICY_DOMAINS.map((d) => {
            const isActive = d.key === activeDomain;
            const hasChanges = hasDomainChanges(d.key);
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => setActiveDomain(d.key)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-brand-50 text-brand-700 border border-brand-200'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {hasChanges && (
                  <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
                )}
                {!hasChanges && <span className="w-2 h-2 flex-shrink-0" />}
                <span className="truncate">{d.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Rule editor panel */}
        <div className="flex-1 bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-slate-900">{activeDomainLabel}</h2>
            {hasDomainChanges(activeDomain) && (
              <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                Unsaved changes
              </span>
            )}
          </div>

          <Panel
            rules={allRules[activeDomain]}
            onUpdate={(patch) => updateDomainRules(activeDomain, patch)}
          />

          {/* Domain actions */}
          <div className="flex items-center gap-3 mt-8 pt-6 border-t border-slate-200">
            <button
              type="button"
              disabled={!hasDomainChanges(activeDomain)}
              onClick={() => restoreDomain(activeDomain)}
              className="px-4 py-2 text-sm font-medium border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              Restore to current
            </button>
            <button
              type="button"
              disabled={previewLoading}
              onClick={() => {
                void handlePreview(activeDomain);
              }}
              className="px-4 py-2 text-sm font-medium border border-brand-300 text-brand-700 bg-brand-50 rounded-lg hover:bg-brand-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {previewLoading ? 'Loading...' : 'Preview Impact'}
            </button>
            {previewError && (
              <span className="text-xs text-red-600">{previewError}</span>
            )}
          </div>
        </div>
      </div>

      {/* Impact preview slide-over */}
      {previewData && (
        <ImpactPreviewSlideOver preview={previewData} onClose={() => setPreviewData(null)} />
      )}

      {/* Confirmation modal */}
      {showConfirm && (
        <ConfirmPublishModal
          domains={POLICY_DOMAINS}
          allRules={allRules}
          savedRules={savedRules}
          onConfirm={() => {
            void handlePublish();
          }}
          onCancel={() => setShowConfirm(false)}
          publishing={publishing}
        />
      )}
    </div>
  );
}
