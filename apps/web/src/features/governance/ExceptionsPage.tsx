import { useState, useEffect, useCallback } from 'react';
import { governanceApi } from '../../shared/api/governance.js';
import { ApiError } from '../../shared/api/client.js';
import { useOrgId } from '../../shared/hooks/useOrgId.js';
import type {
  Exception as GovException,
  GrantExceptionRequest,
  PolicyDomain,
} from '@provenance/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DOMAIN_LABELS: Record<string, string> = {
  product_schema: 'Schema Compliance',
  classification_taxonomy: 'Data Classification',
  versioning_deprecation: 'Versioning Policy',
  access_control: 'Access Control',
  lineage: 'Lineage Completeness',
  slo: 'SLO Requirements',
  agent_access: 'Agent Access',
  interoperability: 'Interoperability',
};

const ALL_DOMAINS: PolicyDomain[] = [
  'product_schema', 'classification_taxonomy', 'versioning_deprecation',
  'access_control', 'lineage', 'slo', 'agent_access', 'interoperability',
];

// ---------------------------------------------------------------------------
// Create Exception Modal
// ---------------------------------------------------------------------------

function CreateExceptionModal({
  onClose,
  onSubmit,
  submitting,
}: {
  onClose: () => void;
  onSubmit: (dto: GrantExceptionRequest) => void;
  submitting: boolean;
}) {
  const [productId, setProductId] = useState('');
  const [domain, setDomain] = useState<PolicyDomain>('product_schema');
  const [reason, setReason] = useState('');
  const [durationDays, setDurationDays] = useState(30);

  function handleSubmit() {
    if (!productId.trim() || !reason.trim()) return;
    const expiresAt = new Date(Date.now() + durationDays * 86400000).toISOString();
    onSubmit({ productId: productId.trim(), policyDomain: domain, exceptionReason: reason.trim(), expiresAt });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Grant Exception</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Product ID</label>
            <input
              type="text"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              placeholder="UUID of the data product"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Policy Domain</label>
            <select
              value={domain}
              onChange={(e) => setDomain(e.target.value as PolicyDomain)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
            >
              {ALL_DOMAINS.map((d) => (
                <option key={d} value={d}>{DOMAIN_LABELS[d]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Reason</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Documented rationale for granting this exception..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Duration</label>
            <select
              value={durationDays}
              onChange={(e) => setDurationDays(parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !productId.trim() || !reason.trim()}
            className="px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Granting...' : 'Grant Exception'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function ExceptionsPage() {
  const orgId = useOrgId();

  const [exceptions, setExceptions] = useState<GovException[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState<'all' | 'active' | 'expired' | 'revoked'>('active');

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const active = filter === 'active' ? true : undefined;
      const res = await governanceApi.exceptions.list(orgId, undefined, active, 100, 0);
      setExceptions(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load exceptions');
    } finally {
      setLoading(false);
    }
  }, [orgId, filter]);

  useEffect(() => { void load(); }, [load]);

  async function handleCreate(dto: GrantExceptionRequest) {
    if (!orgId) return;
    setSubmitting(true);
    try {
      await governanceApi.exceptions.grant(orgId, dto);
      setShowCreate(false);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to grant exception');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(exceptionId: string) {
    if (!orgId) return;
    try {
      await governanceApi.exceptions.revoke(orgId, exceptionId);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to revoke exception');
    }
  }

  const filtered = exceptions.filter((ex) => {
    const now = new Date();
    const expired = new Date(ex.expiresAt) <= now;
    const revoked = ex.revokedAt !== null;
    if (filter === 'active') return !expired && !revoked;
    if (filter === 'expired') return expired && !revoked;
    if (filter === 'revoked') return revoked;
    return true;
  });

  // Find exceptions expiring within 3 days
  const expiringSoon = exceptions.filter((ex) => {
    if (ex.revokedAt) return false;
    const daysLeft = (new Date(ex.expiresAt).getTime() - Date.now()) / 86400000;
    return daysLeft > 0 && daysLeft <= 3;
  });

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Exception Management</h1>
          <p className="mt-1 text-sm text-slate-500">Grant, monitor, and revoke governance exceptions.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700"
        >
          Grant Exception
        </button>
      </div>

      {/* Expiring soon alert */}
      {expiringSoon.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-sm font-medium text-amber-800">
            {expiringSoon.length} exception{expiringSoon.length > 1 ? 's' : ''} expiring within 3 days
          </p>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {(['active', 'expired', 'revoked', 'all'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              filter === f
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <p className="text-sm">No exceptions found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((ex) => {
            const daysLeft = Math.ceil((new Date(ex.expiresAt).getTime() - Date.now()) / 86400000);
            const isActive = !ex.revokedAt && daysLeft > 0;
            return (
              <div
                key={ex.id}
                className={`bg-white border rounded-xl p-5 ${
                  isActive ? 'border-slate-200' : 'border-slate-100 opacity-60'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                        {DOMAIN_LABELS[ex.policyDomain] ?? ex.policyDomain}
                      </span>
                      {ex.revokedAt ? (
                        <span className="text-xs font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-500">Revoked</span>
                      ) : daysLeft <= 0 ? (
                        <span className="text-xs font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-500">Expired</span>
                      ) : daysLeft <= 3 ? (
                        <span className="text-xs font-medium px-2 py-0.5 rounded bg-red-100 text-red-700">{daysLeft}d left</span>
                      ) : (
                        <span className="text-xs font-medium px-2 py-0.5 rounded bg-green-100 text-green-700">{daysLeft}d left</span>
                      )}
                    </div>
                    <p className="text-sm text-slate-700">{ex.exceptionReason}</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Product: {ex.productId.slice(0, 8)}... | Granted: {new Date(ex.grantedAt).toLocaleDateString()} | Expires: {new Date(ex.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  {isActive && (
                    <button
                      type="button"
                      onClick={() => { void handleRevoke(ex.id); }}
                      className="text-xs text-red-600 hover:underline flex-shrink-0 ml-4"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <CreateExceptionModal
          onClose={() => setShowCreate(false)}
          onSubmit={(dto) => { void handleCreate(dto); }}
          submitting={submitting}
        />
      )}
    </div>
  );
}
