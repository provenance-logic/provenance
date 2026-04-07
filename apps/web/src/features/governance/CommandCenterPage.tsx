import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { governanceApi } from '../../shared/api/governance.js';
import { ApiError } from '../../shared/api/client.js';
import { useOrgId } from '../../shared/hooks/useOrgId.js';
import type {
  GovernanceDashboard,
  GovernanceDashboardSummary,
  GovernanceDomainHealth,
  GovernanceComplianceEvent,
  Exception as GovException,
  GracePeriod,
  ComplianceStateValue,
} from '@provenance/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_COLORS: Record<ComplianceStateValue, string> = {
  compliant: 'bg-green-100 text-green-800',
  drift_detected: 'bg-yellow-100 text-yellow-800',
  grace_period: 'bg-orange-100 text-orange-800',
  non_compliant: 'bg-red-100 text-red-800',
};

const STATE_LABELS: Record<ComplianceStateValue, string> = {
  compliant: 'Compliant',
  drift_detected: 'Drift',
  grace_period: 'Grace Period',
  non_compliant: 'Non-Compliant',
};

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

const HEALTH_COLORS: Record<string, string> = {
  green: 'bg-green-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
};

// ---------------------------------------------------------------------------
// Summary bar
// ---------------------------------------------------------------------------

function SummaryBar({
  summary,
  onFilter,
}: {
  summary: GovernanceDashboardSummary;
  onFilter: (state: ComplianceStateValue | null) => void;
}) {
  const cards: { label: string; count: number; state: ComplianceStateValue | null; color: string }[] = [
    { label: 'Total Published', count: summary.totalPublished, state: null, color: 'bg-slate-100 text-slate-800' },
    { label: 'Compliant', count: summary.compliant, state: 'compliant', color: 'bg-green-50 text-green-800 border-green-200' },
    { label: 'Drift Detected', count: summary.driftDetected, state: 'drift_detected', color: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
    { label: 'Grace Period', count: summary.gracePeriod, state: 'grace_period', color: 'bg-orange-50 text-orange-800 border-orange-200' },
    { label: 'Non-Compliant', count: summary.nonCompliant, state: 'non_compliant', color: 'bg-red-50 text-red-800 border-red-200' },
  ];

  return (
    <div className="grid grid-cols-5 gap-4">
      {cards.map((c) => (
        <button
          key={c.label}
          type="button"
          onClick={() => onFilter(c.state)}
          className={`rounded-xl border p-4 text-left transition-shadow hover:shadow-md ${c.color}`}
        >
          <p className="text-2xl font-bold">{c.count}</p>
          <p className="text-xs font-medium mt-1">{c.label}</p>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compliance trend chart (simple bar visualization)
// ---------------------------------------------------------------------------

function ComplianceTrend({ summary }: { summary: GovernanceDashboardSummary }) {
  const total = summary.totalPublished || 1;
  const segments = [
    { label: 'Compliant', pct: (summary.compliant / total) * 100, color: 'bg-green-500' },
    { label: 'Drift', pct: (summary.driftDetected / total) * 100, color: 'bg-yellow-500' },
    { label: 'Grace Period', pct: (summary.gracePeriod / total) * 100, color: 'bg-orange-500' },
    { label: 'Non-Compliant', pct: (summary.nonCompliant / total) * 100, color: 'bg-red-500' },
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-slate-700 mb-3">Compliance Distribution</h2>
      <div className="flex h-6 rounded-full overflow-hidden bg-slate-100">
        {segments.map((s) => (
          s.pct > 0 ? (
            <div
              key={s.label}
              className={`${s.color} transition-all`}
              style={{ width: `${s.pct}%` }}
              title={`${s.label}: ${Math.round(s.pct)}%`}
            />
          ) : null
        ))}
      </div>
      <div className="flex gap-4 mt-3">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${s.color}`} />
            <span className="text-xs text-slate-600">{s.label} ({Math.round(s.pct)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent events feed
// ---------------------------------------------------------------------------

function RecentEvents({ events, orgId }: { events: GovernanceComplianceEvent[]; orgId: string }) {
  const navigate = useNavigate();

  if (events.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Recent Compliance Events</h2>
        <p className="text-xs text-slate-400">No compliance state changes in the last 7 days.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-slate-700 mb-3">Recent Compliance Events</h2>
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {events.map((e, i) => (
          <button
            key={`${e.productId}-${i}`}
            type="button"
            onClick={() => navigate(`/marketplace/${orgId}/${e.productId}`)}
            className="w-full text-left flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATE_COLORS[e.newState]}`}>
              {STATE_LABELS[e.newState]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-800 truncate">{e.productName}</p>
              <p className="text-xs text-slate-400">{e.domainName}</p>
            </div>
            <span className="text-xs text-slate-400 flex-shrink-0">
              {new Date(e.changedAt).toLocaleDateString()}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active exceptions panel
// ---------------------------------------------------------------------------

function ActiveExceptions({ exceptions }: { exceptions: GovException[] }) {
  const navigate = useNavigate();

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-sm font-semibold text-slate-700">Active Exceptions</h2>
        <button
          type="button"
          onClick={() => navigate('/governance/exceptions')}
          className="text-xs text-brand-600 hover:underline"
        >
          View all
        </button>
      </div>
      {exceptions.length === 0 ? (
        <p className="text-xs text-slate-400">No active exceptions.</p>
      ) : (
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {exceptions.map((ex) => {
            const daysLeft = Math.max(0, Math.ceil((new Date(ex.expiresAt).getTime() - Date.now()) / 86400000));
            return (
              <div key={ex.id} className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex justify-between items-start">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-700">{DOMAIN_LABELS[ex.policyDomain] ?? ex.policyDomain}</p>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">{ex.exceptionReason}</p>
                  </div>
                  <span className={`text-xs font-semibold flex-shrink-0 ${daysLeft <= 3 ? 'text-red-600' : 'text-amber-700'}`}>
                    {daysLeft}d left
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active grace periods panel
// ---------------------------------------------------------------------------

function ActiveGracePeriods({ periods }: { periods: GracePeriod[] }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-slate-700 mb-3">Active Grace Periods</h2>
      {periods.length === 0 ? (
        <p className="text-xs text-slate-400">No active grace periods.</p>
      ) : (
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {periods.map((gp) => {
            const daysLeft = Math.max(0, Math.ceil((new Date(gp.endsAt).getTime() - Date.now()) / 86400000));
            return (
              <div key={gp.id} className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-xs font-medium text-slate-700">{DOMAIN_LABELS[gp.policyDomain] ?? gp.policyDomain}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Started {new Date(gp.startedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span className={`text-xs font-semibold ${daysLeft <= 3 ? 'text-red-600' : 'text-orange-700'}`}>
                    {daysLeft}d remaining
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Policy domain health indicators
// ---------------------------------------------------------------------------

function DomainHealth({ domains }: { domains: GovernanceDomainHealth[] }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-slate-700 mb-3">Policy Domain Health</h2>
      <div className="grid grid-cols-2 gap-2">
        {domains.map((d) => {
          const pct = d.totalProducts > 0 ? Math.round((d.compliantCount / d.totalProducts) * 100) : 100;
          return (
            <div key={d.policyDomain} className="flex items-center gap-2 p-2 rounded-lg bg-slate-50">
              <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${HEALTH_COLORS[d.status]}`} />
              <span className="text-xs text-slate-700 flex-1 truncate">
                {DOMAIN_LABELS[d.policyDomain] ?? d.policyDomain}
              </span>
              <span className="text-xs font-medium text-slate-500">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function CommandCenterPage() {
  const orgId = useOrgId();
  const navigate = useNavigate();

  const [dashboard, setDashboard] = useState<GovernanceDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    governanceApi
      .dashboard(orgId)
      .then((d) => { setDashboard(d); setLoading(false); })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Failed to load dashboard');
        setLoading(false);
      });
  }, [orgId]);

  function handleFilter(state: ComplianceStateValue | null) {
    if (state) {
      navigate(`/governance/compliance?state=${state}`);
    } else {
      navigate('/marketplace');
    }
  }

  if (loading) {
    return (
      <div className="p-6 max-w-screen-xl mx-auto">
        <h1 className="text-2xl font-semibold text-slate-900 mb-6">Governance Command Center</h1>
        <div className="grid grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 bg-slate-100 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="p-6 max-w-screen-xl mx-auto">
        <h1 className="text-2xl font-semibold text-slate-900 mb-6">Governance Command Center</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {error ?? 'Failed to load governance dashboard.'}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Governance Command Center</h1>
          <p className="mt-1 text-sm text-slate-500">Organization-wide compliance overview and policy health.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => navigate('/governance/policies')}
            className="px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
          >
            Policy Studio
          </button>
          <button
            type="button"
            onClick={() => navigate('/governance/compliance')}
            className="px-4 py-2 text-sm font-medium border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Compliance Monitor
          </button>
        </div>
      </div>

      <SummaryBar summary={dashboard.summary} onFilter={handleFilter} />

      <ComplianceTrend summary={dashboard.summary} />

      <div className="grid grid-cols-2 gap-6">
        <RecentEvents events={dashboard.recentEvents} orgId={orgId!} />
        <DomainHealth domains={dashboard.domainHealth} />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <ActiveExceptions exceptions={dashboard.activeExceptions} />
        <ActiveGracePeriods periods={dashboard.activeGracePeriods} />
      </div>
    </div>
  );
}
