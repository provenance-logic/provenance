import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  AccessGrant,
  ConnectionReference,
} from '@provenance/types';
import { useOrgId } from '../../shared/hooks/useOrgId.js';
import {
  agentsApi,
  type AgentResponse,
  type ClassificationHistoryEntry,
} from '../../shared/api/agents.js';
import { accessApi } from '../../shared/api/access.js';
import { consentApi } from '../../shared/api/consent.js';
import { formatRelativeTime } from '../notifications/category-labels.js';

const CLASSIFICATION_COLOR: Record<AgentResponse['current_classification'], string> = {
  Observed:    'bg-slate-100 text-slate-700',
  Supervised:  'bg-amber-100 text-amber-800',
  Autonomous:  'bg-violet-100 text-violet-800',
};

type Tab = 'overview' | 'grants' | 'references' | 'history';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview',   label: 'Overview' },
  { id: 'grants',     label: 'Access Grants' },
  { id: 'references', label: 'Connection References' },
  { id: 'history',    label: 'Classification History' },
];

/**
 * Agent detail page (B-057). Resolves an agent by id and exposes four
 * surfaces in a tab strip:
 *
 *  - Overview: identity / classification / oversight / Keycloak client id
 *  - Access Grants: every product this agent has access to (granteePrincipalId
 *    on the access grant equals the agent's id — see jwt-auth.guard.ts:52)
 *  - Connection References: Domain 12 per-use-case consent records
 *  - Classification History: trust-tier transitions with the who/why/when
 *
 * No generic audit-trail tab — there's no list endpoint for that today.
 * Classification history covers the demo claim ("every agent action is
 * provenanced") well enough until the audit log surfaces its own queryable
 * endpoint.
 */
export function AgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const orgId = useOrgId();
  const [agent, setAgent] = useState<AgentResponse | null>(null);
  const [grants, setGrants] = useState<AccessGrant[] | null>(null);
  const [references, setReferences] = useState<ConnectionReference[] | null>(null);
  const [history, setHistory] = useState<ClassificationHistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  const load = useCallback(async () => {
    if (!agentId || !orgId) return;
    setLoading(true);
    setError(null);
    try {
      // Identity first — if the agent doesn't exist, we want to bail before
      // firing the supplementary queries.
      const a = await agentsApi.get(agentId);
      setAgent(a);
      // Supplementary queries run in parallel; partial failure shouldn't
      // block the overview tab from rendering.
      const [g, r, h] = await Promise.allSettled([
        accessApi.grants.list(orgId, { granteePrincipalId: agentId, activeOnly: false, limit: 100 }),
        consentApi.connectionReferences.list(orgId, { agentId, limit: 100 }),
        agentsApi.classificationHistory(agentId),
      ]);
      setGrants(g.status === 'fulfilled' ? g.value.items : []);
      setReferences(r.status === 'fulfilled' ? r.value.items : []);
      setHistory(h.status === 'fulfilled' ? h.value : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [agentId, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !agent) {
    return <div className="p-8 text-sm text-slate-500">Loading agent…</div>;
  }
  if (error) {
    return (
      <div className="p-8">
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
        <p className="mt-4 text-sm">
          <Link to="/agents" className="text-brand-600 hover:text-brand-700">
            ← Back to agents
          </Link>
        </p>
      </div>
    );
  }
  if (!agent) {
    return (
      <div className="p-8">
        <p className="text-sm text-slate-500">Agent not found.</p>
        <p className="mt-4 text-sm">
          <Link to="/agents" className="text-brand-600 hover:text-brand-700">
            ← Back to agents
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-2">
        <Link to="/agents" className="text-xs text-slate-500 hover:text-slate-700">
          ← Back to agents
        </Link>
      </div>
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-2xl font-semibold text-slate-900">{agent.display_name}</h1>
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${CLASSIFICATION_COLOR[agent.current_classification]}`}
        >
          {agent.current_classification}
        </span>
      </div>
      <p className="text-sm text-slate-500 font-mono">{agent.agent_id}</p>

      <div className="mt-6 flex border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t.id
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
            {t.id === 'grants' && grants !== null && (
              <span className="ml-1.5 text-xs text-slate-400">({grants.length})</span>
            )}
            {t.id === 'references' && references !== null && (
              <span className="ml-1.5 text-xs text-slate-400">({references.length})</span>
            )}
            {t.id === 'history' && history !== null && (
              <span className="ml-1.5 text-xs text-slate-400">({history.length})</span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === 'overview'   && <OverviewTab   agent={agent} />}
        {tab === 'grants'     && <GrantsTab     grants={grants} />}
        {tab === 'references' && <ReferencesTab references={references} />}
        {tab === 'history'    && <HistoryTab    history={history} />}
      </div>
    </div>
  );
}

function OverviewTab({ agent }: { agent: AgentResponse }) {
  return (
    <dl className="bg-white border border-slate-200 rounded p-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
      <div>
        <dt className="text-slate-500">Display name</dt>
        <dd className="mt-0.5 text-slate-900">{agent.display_name}</dd>
      </div>
      <div>
        <dt className="text-slate-500">Current classification</dt>
        <dd className="mt-0.5 text-slate-900">{agent.current_classification}</dd>
      </div>
      <div>
        <dt className="text-slate-500">Classification scope</dt>
        <dd className="mt-0.5 text-slate-900">{agent.classification_scope}</dd>
      </div>
      <div>
        <dt className="text-slate-500">Last classification change</dt>
        <dd className="mt-0.5 text-slate-900">
          {agent.classification_changed_at
            ? formatRelativeTime(agent.classification_changed_at)
            : 'never'}
        </dd>
      </div>
      <div>
        <dt className="text-slate-500">Classification reason</dt>
        <dd className="mt-0.5 text-slate-900">
          {agent.classification_reason ?? <span className="text-slate-400 italic">none</span>}
        </dd>
      </div>
      <div>
        <dt className="text-slate-500">Model</dt>
        <dd className="mt-0.5 text-slate-900">
          {agent.model_provider} / {agent.model_name}
        </dd>
      </div>
      <div className="col-span-2">
        <dt className="text-slate-500">Human oversight contact</dt>
        <dd className="mt-0.5 text-slate-900">{agent.human_oversight_contact}</dd>
      </div>
      <div className="col-span-2">
        <dt className="text-slate-500">Keycloak client</dt>
        <dd className="mt-0.5 text-slate-900 font-mono text-xs">{agent.keycloak_client_id}</dd>
      </div>
      <div>
        <dt className="text-slate-500">Registered</dt>
        <dd className="mt-0.5 text-slate-900">{formatRelativeTime(agent.created_at)}</dd>
      </div>
      <div>
        <dt className="text-slate-500">Registered by</dt>
        <dd className="mt-0.5 text-slate-900 font-mono text-xs">
          {agent.registered_by_principal_id}
        </dd>
      </div>
    </dl>
  );
}

function GrantsTab({ grants }: { grants: AccessGrant[] | null }) {
  if (grants === null) return <div className="text-sm text-slate-500">Loading…</div>;
  if (grants.length === 0) {
    return (
      <div className="p-6 bg-white border border-slate-200 rounded text-sm text-slate-500">
        No access grants. This agent doesn't have product access yet.
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {grants.map((g) => {
        const active = !g.revokedAt && (!g.expiresAt || new Date(g.expiresAt) > new Date());
        return (
          <li key={g.id} className="bg-white border border-slate-200 rounded p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <Link
                  to={`/marketplace/${g.orgId}/${g.productId}`}
                  className="text-sm font-semibold text-slate-900 hover:text-brand-700"
                >
                  Product {g.productId.slice(0, 8)}…
                </Link>
                <p className="mt-1 text-xs text-slate-500">
                  Granted {formatRelativeTime(g.grantedAt)}
                  {g.expiresAt && <> · expires {formatRelativeTime(g.expiresAt)}</>}
                  {g.revokedAt && <> · revoked {formatRelativeTime(g.revokedAt)}</>}
                </p>
                {g.accessScope && (
                  <p className="mt-1 text-xs text-slate-500">
                    Scope: <span className="text-slate-700">{JSON.stringify(g.accessScope)}</span>
                  </p>
                )}
              </div>
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  active ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {active ? 'Active' : g.revokedAt ? 'Revoked' : 'Expired'}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function ReferencesTab({ references }: { references: ConnectionReference[] | null }) {
  if (references === null) return <div className="text-sm text-slate-500">Loading…</div>;
  if (references.length === 0) {
    return (
      <div className="p-6 bg-white border border-slate-200 rounded text-sm text-slate-500">
        No connection references. Domain 12 requires an active connection reference for any
        agent action — this agent has none, so it can't act against any product yet.
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {references.map((r) => {
        const isLegacy = r.causedBy === 'legacy_migration';
        return (
          <li
            key={r.id}
            className={`rounded p-4 ${
              isLegacy
                ? 'bg-amber-50 border-2 border-dashed border-amber-300'
                : 'bg-white border border-slate-200'
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link
                    to={`/marketplace/${r.orgId}/${r.productId}`}
                    className="text-sm font-semibold text-slate-900 hover:text-brand-700"
                  >
                    Product {r.productId.slice(0, 8)}…
                  </Link>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      r.state === 'active'    ? 'bg-green-100 text-green-800' :
                      r.state === 'pending'   ? 'bg-amber-100 text-amber-800' :
                      r.state === 'suspended' ? 'bg-orange-100 text-orange-800' :
                                                'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {r.state}
                  </span>
                  {isLegacy && (
                    <span
                      className="text-xs px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 font-semibold uppercase tracking-wide"
                      title="Auto-provisioned legacy compatibility reference (F12.25). Non-renewable — when this expires the agent must submit a proper connection-reference request to continue access. Created at Domain 12 enforcement activation to keep existing agent-product grants working through the transition."
                    >
                      Legacy · non-renewable
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm text-slate-700">
                  <span className="text-slate-500">Use case:</span>{' '}
                  {r.useCaseCategory}
                </p>
                <p className="mt-1 text-sm text-slate-700 italic">
                  "{r.purposeElaboration}"
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Requested {formatRelativeTime(r.requestedAt)}
                  {r.approvedAt && <> · approved {formatRelativeTime(r.approvedAt)}</>}
                  {' · '}expires {formatRelativeTime(r.expiresAt)}
                </p>
                {isLegacy && (
                  <p className="mt-2 text-xs text-amber-800">
                    This is a legacy compatibility reference created at Domain 12 enforcement activation. It cannot be renewed — submit a proper connection-reference request before the expiry date above to continue access.
                  </p>
                )}
                {r.denialReason && (
                  <p className="mt-1 text-xs text-red-700">
                    Denial reason: {r.denialReason}
                  </p>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function HistoryTab({ history }: { history: ClassificationHistoryEntry[] | null }) {
  if (history === null) return <div className="text-sm text-slate-500">Loading…</div>;
  if (history.length === 0) {
    return (
      <div className="p-6 bg-white border border-slate-200 rounded text-sm text-slate-500">
        No classification changes recorded. The agent has held its initial classification since registration.
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {history.map((h) => (
        <li key={h.classification_id} className="bg-white border border-slate-200 rounded p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900">
                Classification: <span className="font-semibold">{h.classification}</span>
                {' '}
                <span className="text-xs text-slate-500">(scope: {h.scope})</span>
              </p>
              {h.reason && (
                <p className="mt-1 text-sm text-slate-700 italic">"{h.reason}"</p>
              )}
              <p className="mt-2 text-xs text-slate-500">
                Set by <span className="font-mono">{h.changed_by_principal_id}</span>
                {' '}({h.changed_by_principal_type}) · {formatRelativeTime(h.effective_from)}
                {h.effective_until && <> · ended {formatRelativeTime(h.effective_until)}</>}
              </p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
