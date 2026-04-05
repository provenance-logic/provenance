import React, { useState, useEffect, useRef } from 'react';
import { accessApi } from '../../shared/api/access.js';
import { ApiError } from '../../shared/api/client.js';
import type { AccessRequest, Port } from '@provenance/types';

interface Props {
  orgId: string;
  productId: string;
  productName: string;
  outputPorts: Port[];
  existingRequest: AccessRequest | null;
  onClose: () => void;
  onSubmitted: (request: AccessRequest) => void;
}

const DURATION_OPTIONS = [
  { value: 30,  label: '30 days' },
  { value: 60,  label: '60 days' },
  { value: 90,  label: '90 days' },
  { value: 180, label: '180 days' },
  { value: 0,   label: 'Custom…' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending:   { label: 'Pending Review',  color: 'text-yellow-700 bg-yellow-50 border-yellow-200' },
  approved:  { label: 'Approved',        color: 'text-green-700 bg-green-50 border-green-200'   },
  denied:    { label: 'Denied',          color: 'text-red-700 bg-red-50 border-red-200'         },
  withdrawn: { label: 'Withdrawn',       color: 'text-slate-600 bg-slate-50 border-slate-200'   },
};

export function AccessRequestSlideOver({
  orgId,
  productId,
  productName,
  outputPorts,
  existingRequest,
  onClose,
  onSubmitted,
}: Props) {
  const [intendedUse, setIntendedUse]       = useState('');
  const [justification, setJustification]   = useState('');
  const [durationDays, setDurationDays]     = useState<number>(30);
  const [customDays, setCustomDays]         = useState('');
  const [selectedPorts, setSelectedPorts]   = useState<string[]>([]);
  const [submitting, setSubmitting]         = useState(false);
  const [fieldErrors, setFieldErrors]       = useState<Record<string, string>>({});
  const [submitError, setSubmitError]       = useState<string | null>(null);

  const firstFieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Trap focus and scroll lock.
    firstFieldRef.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // If request already exists, show status view instead.
  if (existingRequest) {
    const cfg = STATUS_CONFIG[existingRequest.status] ?? STATUS_CONFIG.pending;
    return (
      <SlideOverShell productName={productName} onClose={onClose}>
        <div className={`rounded-lg border p-4 ${cfg.color}`}>
          <p className="text-sm font-semibold">{cfg.label}</p>
          {existingRequest.justification && (
            <p className="mt-2 text-xs opacity-80">
              <span className="font-medium">Your request: </span>
              {existingRequest.justification}
            </p>
          )}
          <p className="mt-2 text-xs opacity-70">
            Submitted {new Date(existingRequest.requestedAt).toLocaleDateString()}
          </p>
          {existingRequest.resolutionNote && (
            <p className="mt-2 text-xs opacity-80">
              <span className="font-medium">Note: </span>
              {existingRequest.resolutionNote}
            </p>
          )}
        </div>
        {existingRequest.status === 'denied' || existingRequest.status === 'withdrawn' ? (
          <p className="mt-4 text-xs text-slate-500">
            You may submit a new request by refreshing the page.
          </p>
        ) : null}
      </SlideOverShell>
    );
  }

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!intendedUse.trim()) errors.intendedUse = 'Intended use is required.';
    if (durationDays === 0 && (!customDays || parseInt(customDays, 10) < 1)) {
      errors.customDays = 'Enter a valid number of days.';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const days = durationDays === 0 ? parseInt(customDays, 10) : durationDays;
    const combinedJustification = justification.trim()
      ? `Intended use: ${intendedUse.trim()}\n\n${justification.trim()}`
      : `Intended use: ${intendedUse.trim()}`;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const request = await accessApi.requests.submit(orgId, {
        productId,
        justification: combinedJustification,
        accessScope: {
          requestedDurationDays: days,
          ...(selectedPorts.length > 0 && { portIds: selectedPorts }),
        },
      });
      onSubmitted(request);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Failed to submit request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function togglePort(portId: string) {
    setSelectedPorts((prev) =>
      prev.includes(portId) ? prev.filter((id) => id !== portId) : [...prev, portId],
    );
  }

  return (
    <SlideOverShell productName={productName} onClose={onClose}>
      <form onSubmit={(e) => { void handleSubmit(e); }} noValidate>
        <div className="space-y-5">

          {/* Intended use */}
          <div>
            <label htmlFor="intendedUse" className="block text-sm font-medium text-slate-700 mb-1">
              Intended use <span className="text-red-500" aria-hidden>*</span>
            </label>
            <textarea
              id="intendedUse"
              ref={firstFieldRef}
              rows={3}
              value={intendedUse}
              onChange={(e) => setIntendedUse(e.target.value)}
              placeholder="Describe how you will use this data product…"
              className={`w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none ${
                fieldErrors.intendedUse ? 'border-red-400' : 'border-slate-300'
              }`}
              aria-required="true"
              aria-describedby={fieldErrors.intendedUse ? 'intendedUse-error' : undefined}
            />
            {fieldErrors.intendedUse && (
              <p id="intendedUse-error" className="mt-1 text-xs text-red-600" role="alert">
                {fieldErrors.intendedUse}
              </p>
            )}
          </div>

          {/* Additional justification */}
          <div>
            <label htmlFor="justification" className="block text-sm font-medium text-slate-700 mb-1">
              Additional justification
            </label>
            <textarea
              id="justification"
              rows={2}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Any additional context for the data owner…"
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            />
          </div>

          {/* Requested duration */}
          <div>
            <label htmlFor="duration" className="block text-sm font-medium text-slate-700 mb-1">
              Requested duration
            </label>
            <select
              id="duration"
              value={durationDays}
              onChange={(e) => setDurationDays(parseInt(e.target.value, 10))}
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
            >
              {DURATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {durationDays === 0 && (
              <div className="mt-2">
                <input
                  type="number"
                  min={1}
                  max={3650}
                  placeholder="Days"
                  value={customDays}
                  onChange={(e) => setCustomDays(e.target.value)}
                  className={`w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                    fieldErrors.customDays ? 'border-red-400' : 'border-slate-300'
                  }`}
                  aria-label="Custom duration in days"
                />
                {fieldErrors.customDays && (
                  <p className="mt-1 text-xs text-red-600" role="alert">{fieldErrors.customDays}</p>
                )}
              </div>
            )}
          </div>

          {/* Output port selection */}
          {outputPorts.length > 0 && (
            <fieldset>
              <legend className="block text-sm font-medium text-slate-700 mb-1">
                Requested ports{' '}
                <span className="text-slate-400 font-normal">(optional — leave blank for full access)</span>
              </legend>
              <div className="space-y-1 border border-slate-200 rounded-lg p-3 bg-slate-50">
                {outputPorts.map((port) => (
                  <label key={port.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedPorts.includes(port.id)}
                      onChange={() => togglePort(port.id)}
                      className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    />
                    <span className="text-sm text-slate-700">{port.name}</span>
                    {port.interfaceType && (
                      <span className="text-xs text-slate-400">{port.interfaceType.replace(/_/g, ' ')}</span>
                    )}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {submitError && (
            <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              {submitError}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 bg-brand-600 text-white text-sm font-medium py-2.5 rounded-lg hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
            >
              {submitting ? 'Submitting…' : 'Request Access'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-white border border-slate-300 text-slate-700 text-sm font-medium py-2.5 rounded-lg hover:bg-slate-50 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              Cancel
            </button>
          </div>
        </div>
      </form>
    </SlideOverShell>
  );
}

// ---------------------------------------------------------------------------
// Slide-over shell
// ---------------------------------------------------------------------------

function SlideOverShell({
  productName,
  onClose,
  children,
}: {
  productName: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40"
        aria-hidden
        onClick={onClose}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="slideOver-title"
        className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-xl z-50 flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 id="slideOver-title" className="text-base font-semibold text-slate-900">
              Request Access
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate max-w-xs">{productName}</p>
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>
      </div>
    </>
  );
}
