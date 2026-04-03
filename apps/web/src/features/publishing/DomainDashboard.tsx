import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { organizationsApi } from '../../shared/api/organizations.js';
import { productsApi } from '../../shared/api/products.js';
import type { Domain, DataProduct } from '@provenance/types';

export function DomainDashboard() {
  const { orgId, domainId } = useParams<{ orgId: string; domainId: string }>();
  const [domain, setDomain] = useState<Domain | null>(null);
  const [products, setProducts] = useState<DataProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId || !domainId) return;
    Promise.all([
      organizationsApi.domains.get(orgId, domainId),
      productsApi.list(orgId, domainId),
    ])
      .then(([d, p]) => {
        setDomain(d);
        setProducts(p.items);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [orgId, domainId]);

  if (loading) return <PageShell><Spinner /></PageShell>;
  if (error) return <PageShell><ErrorBanner message={error} /></PageShell>;

  return (
    <PageShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{domain?.name}</h1>
          {domain?.description && (
            <p className="mt-1 text-sm text-slate-500">{domain.description}</p>
          )}
        </div>
        <Link
          to="products/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
        >
          New Data Product
        </Link>
      </div>

      {products.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} orgId={orgId!} domainId={domainId!} />
          ))}
        </div>
      )}
    </PageShell>
  );
}

function ProductCard({ product, orgId, domainId }: { product: DataProduct; orgId: string; domainId: string }) {
  const statusColors: Record<string, string> = {
    draft: 'bg-yellow-100 text-yellow-800',
    published: 'bg-green-100 text-green-800',
    deprecated: 'bg-orange-100 text-orange-800',
    decommissioned: 'bg-red-100 text-red-800',
  };

  return (
    <Link
      to={`/dashboard/${orgId}/domains/${domainId}/products/${product.id}`}
      className="block p-5 bg-white rounded-lg border border-slate-200 hover:border-brand-500 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium text-slate-900 text-sm">{product.name}</h3>
        <span className={`flex-shrink-0 inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[product.status]}`}>
          {product.status}
        </span>
      </div>
      {product.description && (
        <p className="mt-2 text-xs text-slate-500 line-clamp-2">{product.description}</p>
      )}
      <div className="mt-3 flex items-center gap-3 text-xs text-slate-400">
        <span>{product.ports.length} ports</span>
        <span>v{product.version}</span>
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-16">
      <div className="text-4xl mb-4">📦</div>
      <h3 className="text-sm font-medium text-slate-900">No data products yet</h3>
      <p className="mt-1 text-sm text-slate-500">Create your first data product to get started.</p>
    </div>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="p-8 max-w-6xl mx-auto">{children}</div>;
}

function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-md bg-red-50 p-4 border border-red-200">
      <p className="text-sm text-red-700">{message}</p>
    </div>
  );
}
