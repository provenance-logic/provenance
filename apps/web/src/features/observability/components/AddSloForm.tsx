import { useState } from 'react';
import type { SloDeclarationDto, CreateSloDeclarationDto, SloType, ThresholdOperator } from '@provenance/types';
import { createSlo } from '../api/slo-api.js';

const SLO_TYPES: { value: SloType; label: string }[] = [
  { value: 'freshness',    label: 'Freshness' },
  { value: 'null_rate',    label: 'Null Rate' },
  { value: 'latency',      label: 'Latency' },
  { value: 'completeness', label: 'Completeness' },
  { value: 'custom',       label: 'Custom' },
];

const OPERATORS: { value: ThresholdOperator; label: string }[] = [
  { value: 'lt',  label: '< (less than)' },
  { value: 'lte', label: '≤ (at most)' },
  { value: 'gt',  label: '> (greater than)' },
  { value: 'gte', label: '≥ (at least)' },
  { value: 'eq',  label: '= (equal to)' },
];

interface Props {
  orgId: string;
  productId: string;
  onCreated: (slo: SloDeclarationDto) => void;
  onCancel: () => void;
}

export function AddSloForm({ orgId, productId, onCreated, onCancel }: Props) {
  const [name, setName] = useState('');
  const [sloType, setSloType] = useState<SloType>('freshness');
  const [metricName, setMetricName] = useState('');
  const [operator, setOperator] = useState<ThresholdOperator>('lte');
  const [thresholdValue, setThresholdValue] = useState('');
  const [thresholdUnit, setThresholdUnit] = useState('');
  const [windowHours, setWindowHours] = useState('24');
  const [externalSystem, setExternalSystem] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim() !== '' && metricName.trim() !== '' && thresholdValue.trim() !== '';

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);

    const dto: CreateSloDeclarationDto = {
      name: name.trim(),
      slo_type: sloType,
      metric_name: metricName.trim(),
      threshold_operator: operator,
      threshold_value: Number(thresholdValue),
      ...(thresholdUnit.trim() && { threshold_unit: thresholdUnit.trim() }),
      ...(windowHours.trim() && { evaluation_window_hours: Number(windowHours) }),
      ...(externalSystem.trim() && { external_system: externalSystem.trim() }),
    };

    try {
      const created = await createSlo(orgId, productId, dto);
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create SLO');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-slate-700">New SLO Declaration</h3>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* Name */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Data freshness within 24h"
            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {/* SLO Type */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
          <select
            value={sloType}
            onChange={(e) => setSloType(e.target.value as SloType)}
            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {SLO_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Metric Name */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Metric Name *</label>
          <input
            type="text"
            value={metricName}
            onChange={(e) => setMetricName(e.target.value)}
            placeholder="e.g. data_age_hours"
            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {/* Operator */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Operator</label>
          <select
            value={operator}
            onChange={(e) => setOperator(e.target.value as ThresholdOperator)}
            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {OPERATORS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Threshold Value */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Threshold *</label>
          <input
            type="number"
            value={thresholdValue}
            onChange={(e) => setThresholdValue(e.target.value)}
            placeholder="24"
            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {/* Threshold Unit */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Unit</label>
          <input
            type="text"
            value={thresholdUnit}
            onChange={(e) => setThresholdUnit(e.target.value)}
            placeholder="hours, ms, percent..."
            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {/* Window Hours */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Eval Window (hours)</label>
          <input
            type="number"
            value={windowHours}
            onChange={(e) => setWindowHours(e.target.value)}
            placeholder="24"
            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {/* External System */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">External System</label>
          <input
            type="text"
            value={externalSystem}
            onChange={(e) => setExternalSystem(e.target.value)}
            placeholder="e.g. airflow, dbt, great_expectations"
            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={() => { void handleSubmit(); }}
          disabled={!canSubmit || submitting}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-60"
        >
          {submitting && (
            <div className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" aria-hidden />
          )}
          Create SLO
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-medium px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors focus:outline-none"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
