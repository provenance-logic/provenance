import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { NavShell } from '../shared/components/NavShell.js';
import { DashboardRedirect } from '../features/publishing/DashboardRedirect.js';
import { DomainDashboard } from '../features/publishing/DomainDashboard.js';
import { NewProductForm } from '../features/publishing/NewProductForm.js';
import { ProductDetail } from '../features/publishing/ProductDetail.js';
import { MarketplacePage } from '../features/discovery/MarketplacePage.js';
import { ProductDetailPage } from '../features/discovery/ProductDetailPage.js';
import { CommandCenterPage } from '../features/governance/CommandCenterPage.js';
import { PolicyStudioPage } from '../features/governance/PolicyStudioPage.js';
import { ComplianceMonitorPage } from '../features/governance/ComplianceMonitorPage.js';
import { ExceptionsPage } from '../features/governance/ExceptionsPage.js';

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
          <Route path="dashboard" element={<DashboardRedirect />} />
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

          {/* Marketplace */}
          <Route path="marketplace" element={<MarketplacePage />} />
          <Route path="marketplace/:orgId/:productId" element={<ProductDetailPage />} />

          <Route path="governance" element={<CommandCenterPage />} />
          <Route path="governance/policies" element={<PolicyStudioPage />} />
          <Route path="governance/compliance" element={<ComplianceMonitorPage />} />
          <Route path="governance/exceptions" element={<ExceptionsPage />} />
          <Route path="agents" element={<ComingSoon title="Agents" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
