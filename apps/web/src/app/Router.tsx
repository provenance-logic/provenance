import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { NavShell } from '../shared/components/NavShell.js';
import { DomainDashboard } from '../features/publishing/DomainDashboard.js';
import { NewProductForm } from '../features/publishing/NewProductForm.js';
import { ProductDetail } from '../features/publishing/ProductDetail.js';

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      <p className="mt-2 text-sm text-slate-500">Coming in a later phase.</p>
    </div>
  );
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<NavShell />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DomainDashboard />} />
          <Route
            path="dashboard/:orgId/domains/:domainId"
            element={<DomainDashboard />}
          />
          <Route
            path="dashboard/:orgId/domains/:domainId/products/new"
            element={<NewProductForm />}
          />
          <Route
            path="dashboard/:orgId/domains/:domainId/products/:productId"
            element={<ProductDetail />}
          />
          <Route path="products" element={<Navigate to="/dashboard" replace />} />
          <Route path="marketplace" element={<ComingSoon title="Marketplace" />} />
          <Route path="governance" element={<ComingSoon title="Governance" />} />
          <Route path="agents" element={<ComingSoon title="Agents" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
