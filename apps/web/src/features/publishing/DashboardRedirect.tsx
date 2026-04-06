import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { organizationsApi } from '../../shared/api/organizations.js';

type RedirectState = 'loading' | 'no-org' | 'no-domain' | 'error';

export function DashboardRedirect() {
  const navigate = useNavigate();
  const [state, setState] = useState<RedirectState>('loading');
  const [error, setError] = useState('');
  const [orgId, setOrgId] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      try {
        const orgs = await organizationsApi.list(1, 0);
        if (cancelled) return;

        if (orgs.items.length === 0) {
          setState('no-org');
          return;
        }

        const org = orgs.items[0];
        setOrgId(org.id);

        const domains = await organizationsApi.domains.list(org.id, 1, 0);
        if (cancelled) return;

        if (domains.items.length === 0) {
          setState('no-domain');
          return;
        }

        navigate(`/dashboard/${org.id}/domains/${domains.items[0].id}`, { replace: true });
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load organizations');
        setState('error');
      }
    }

    resolve();
    return () => { cancelled = true; };
  }, [navigate]);

  if (state === 'loading') {
    return (
      <Shell>
        <div className="flex flex-col items-center py-16 gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          <p className="text-sm text-slate-500">Loading your workspace...</p>
        </div>
      </Shell>
    );
  }

  if (state === 'error') {
    return (
      <Shell>
        <div className="rounded-md bg-red-50 p-4 border border-red-200">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      </Shell>
    );
  }

  if (state === 'no-org') {
    return (
      <Shell>
        <div className="text-center py-16">
          <div className="text-4xl mb-4">🏢</div>
          <h2 className="text-lg font-semibold text-slate-900">Welcome to Provenance</h2>
          <p className="mt-2 text-sm text-slate-500 max-w-md mx-auto">
            You don't belong to an organization yet. Create one to start defining
            domains and data products.
          </p>
          <button
            onClick={() => navigate('/onboarding/org')}
            className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            Create Organization
          </button>
        </div>
      </Shell>
    );
  }

  // state === 'no-domain'
  return (
    <Shell>
      <div className="text-center py-16">
        <div className="text-4xl mb-4">📂</div>
        <h2 className="text-lg font-semibold text-slate-900">No domains yet</h2>
        <p className="mt-2 text-sm text-slate-500 max-w-md mx-auto">
          Your organization exists but has no domains. Create a domain to start
          organizing your data products.
        </p>
        <button
          onClick={() => navigate(`/onboarding/domain?orgId=${orgId}`)}
          className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
        >
          Create Domain
        </button>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="p-8 max-w-6xl mx-auto">{children}</div>;
}
