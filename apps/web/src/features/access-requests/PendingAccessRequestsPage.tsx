import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AccessRequest } from '@provenance/types';
import { useOrgId } from '../../shared/hooks/useOrgId.js';
import { accessApi } from '../../shared/api/access.js';
import { formatRelativeTime } from '../notifications/category-labels.js';

const PAGE_SIZE = 50;

/**
 * Pending access requests management page — the proper home for the
 * approval workflow. Lists every request the calling principal can act on
 * (the backend's `forApprover=me` filter resolves to "requests for products
 * I own"). Approve / Deny inline per row.
 *
 * Replaces the previous demo path of "click the notification to approve" —
 * notifications now alert the user that requests exist, and deep-link here
 * for the actual workflow (see B-055 retraction in resolved.md).
 */
export function PendingAccessRequestsPage() {
  const orgId = useOrgId();
  const [items, setItems] = useState<AccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const result = await accessApi.requests.list(orgId, {
        forApprover: 'me',
        status: 'pending',
        limit: PAGE_SIZE,
      });
      setItems(result.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const markActing = (requestId: string, on: boolean) => {
    setActing((prev) => {
      const next = new Set(prev);
      if (on) next.add(requestId);
      else next.delete(requestId);
      return next;
    });
  };

  const handleApprove = async (request: AccessRequest) => {
    if (!orgId) return;
    if (!window.confirm(`Approve access request from ${request.requesterPrincipalId.slice(0, 8)}… for this product?`)) return;
    markActing(request.id, true);
    setActionError(null);
    try {
      await accessApi.requests.approve(orgId, request.id);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      markActing(request.id, false);
    }
  };

  const handleDeny = async (request: AccessRequest) => {
    if (!orgId) return;
    const note = window.prompt('Optional denial reason (recorded in audit trail). Leave blank to skip.');
    if (note === null) return; // cancelled
    markActing(request.id, true);
    setActionError(null);
    try {
      await accessApi.requests.deny(orgId, request.id, note ? { note } : {});
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      markActing(request.id, false);
    }
  };

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Pending Access Requests</h1>
        <p className="mt-1 text-sm text-slate-500">
          Requests waiting on your approval. Each one represents a consumer asking to use a product you own.
          Approving generates a connection package with the access details the consumer needs to start using the product.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          Failed to load: {error}
        </div>
      )}
      {actionError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          Action failed: {actionError}
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
      ) : items.length === 0 ? (
        <div className="p-8 text-center bg-white rounded border border-slate-200">
          <p className="text-sm font-medium text-slate-700">No pending access requests.</p>
          <p className="mt-1 text-xs text-slate-500">
            When a consumer requests access to one of your products, it will appear here.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((request) => {
            const isActing = acting.has(request.id);
            return (
              <li
                key={request.id}
                className="bg-white rounded border border-slate-200 p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <Link
                        to={`/marketplace/${request.orgId}/${request.productId}`}
                        className="text-base font-semibold text-slate-900 hover:text-brand-700"
                      >
                        Product {request.productId.slice(0, 8)}…
                      </Link>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                        Pending
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-700">
                      <span className="text-slate-500">Requester:</span>{' '}
                      <span className="font-mono text-xs">{request.requesterPrincipalId}</span>
                    </p>
                    {request.justification && (
                      <p className="mt-2 text-sm text-slate-700">
                        <span className="text-slate-500">Justification:</span>{' '}
                        <span className="italic">"{request.justification}"</span>
                      </p>
                    )}
                    <p className="mt-2 text-xs text-slate-500">
                      Submitted {formatRelativeTime(request.requestedAt)}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={isActing}
                      onClick={() => { void handleApprove(request); }}
                      className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-1.5 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isActing ? 'Working…' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      disabled={isActing}
                      onClick={() => { void handleDeny(request); }}
                      className="bg-white hover:bg-red-50 border border-red-300 text-red-700 text-sm font-medium px-4 py-1.5 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Deny
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
