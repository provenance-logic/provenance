import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { organizationsApi } from '../../shared/api/organizations.js';
import { productsApi } from '../../shared/api/products.js';
import type { Domain, Organization } from '@provenance/types';

interface DomainWithCount extends Domain {
  productCount: number;
}

type PageState = 'loading' | 'no-org' | 'no-domain' | 'ready' | 'error';

export function DashboardRedirect() {
  const navigate = useNavigate();
  const [state, setState] = useState<PageState>('loading');
  const [error, setError] = useState('');
  const [org, setOrg] = useState<Organization | null>(null);
  const [domains, setDomains] = useState<DomainWithCount[]>([]);

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

        const orgData = orgs.items[0];
        setOrg(orgData);

        const domainList = await organizationsApi.domains.list(orgData.id);
        if (cancelled) return;

        if (domainList.items.length === 0) {
          setState('no-domain');
          return;
        }

        // Fetch product counts for each domain in parallel
        const domainsWithCounts = await Promise.all(
          domainList.items.map(async (d) => {
            try {
              const products = await productsApi.list(orgData.id, d.id, undefined, 1, 0);
              return { ...d, productCount: products.meta.total };
            } catch {
              return { ...d, productCount: 0 };
            }
          }),
        );
        if (cancelled) return;

        setDomains(domainsWithCounts);
        setState('ready');
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

  if (state === 'no-domain') {
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
            onClick={() => navigate(`/onboarding/domain?orgId=${org?.id}`)}
            className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            Create Domain
          </button>
        </div>
      </Shell>
    );
  }

  // state === 'ready' — show all domains
  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Data Products</h1>
        <p className="mt-1 text-sm text-slate-500">
          Browse domains and their data products across your organization.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {domains.map((domain) => (
          <DomainCard key={domain.id} domain={domain} orgId={org!.id} />
        ))}
      </div>
    </Shell>
  );
}

function DomainCard({ domain, orgId }: { domain: DomainWithCount; orgId: string }) {
  return (
    <Link
      to={`/dashboard/${orgId}/domains/${domain.id}`}
      className="block p-5 bg-white rounded-lg border border-slate-200 hover:border-brand-500 hover:shadow-sm transition-all"
    >
      <h3 className="font-medium text-slate-900">{domain.name}</h3>
      {domain.description && (
        <p className="mt-1 text-sm text-slate-500 line-clamp-2">{domain.description}</p>
      )}
      <div className="mt-3 text-xs text-slate-400">
        {domain.productCount} {domain.productCount === 1 ? 'product' : 'products'}
      </div>
    </Link>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="p-8 max-w-6xl mx-auto">{children}</div>;
}
