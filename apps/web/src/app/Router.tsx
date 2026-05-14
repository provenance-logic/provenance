import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { NavShell } from '../shared/components/NavShell.js';
import { RequireAuth, RequireOrg } from '../auth/AuthProvider.js';
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
import { NewOrganizationForm } from '../features/onboarding/NewOrganizationForm.js';
import { NewDomainForm } from '../features/onboarding/NewDomainForm.js';
import { AcceptInvitePage } from '../features/onboarding/AcceptInvitePage.js';
import { DomainTeamPage } from '../features/team/DomainTeamPage.js';
import { OrgRolesPage } from '../features/team/OrgRolesPage.js';
import { NotificationsPage } from '../features/notifications/NotificationsPage.js';
import { NotificationPreferencesPage } from '../features/notifications/NotificationPreferencesPage.js';

function ComingSoon({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      <p className="mt-2 text-sm text-slate-500">
        {detail ?? 'Coming in a later phase.'}
      </p>
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-slate-900">Page not found</h1>
      <p className="mt-2 text-sm text-slate-500">
        That URL doesn&apos;t resolve to a page.
      </p>
      <div className="mt-4 flex gap-3 text-sm">
        <Link to="/dashboard" className="text-brand-600 hover:text-brand-700">
          Go to dashboard
        </Link>
        <Link to="/notifications" className="text-brand-600 hover:text-brand-700">
          View notifications
        </Link>
      </div>
    </div>
  );
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes — no forced Keycloak login. Must match the
            PUBLIC_PATH_PREFIXES list in AuthProvider. */}
        <Route path="/accept-invite" element={<AcceptInvitePage />} />

        {/* Everything below requires an authenticated session. */}
        <Route
          path="/"
          element={
            <RequireAuth>
              <RequireOrg>
                <NavShell />
              </RequireOrg>
            </RequireAuth>
          }
        >
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
          <Route
            path="dashboard/:orgId/domains/:domainId/team"
            element={<DomainTeamPage />}
          />
          <Route
            path="dashboard/:orgId/roles"
            element={<OrgRolesPage />}
          />

          {/* Onboarding — F10.2 self-serve org creation */}
          <Route path="onboarding/org" element={<NewOrganizationForm />} />
          <Route path="onboarding/domain" element={<NewDomainForm />} />

          {/* Marketplace */}
          <Route path="marketplace" element={<MarketplacePage />} />
          <Route path="marketplace/:orgId/:productId" element={<ProductDetailPage />} />

          <Route path="governance" element={<CommandCenterPage />} />
          <Route path="governance/policies" element={<PolicyStudioPage />} />
          <Route path="governance/compliance" element={<ComplianceMonitorPage />} />
          <Route path="governance/exceptions" element={<ExceptionsPage />} />
          <Route
            path="agents"
            element={
              <ComingSoon
                title="Agents"
                detail="Agent management UI is in development (tracked as B-026). The agent backend is fully shipped — agents can self-register via the MCP register_agent tool today, and every MCP tool call is audited under an agent identity. This page will surface that data once the UI lands."
              />
            }
          />

          {/* Notifications (Domain 11 — F11.4) */}
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="notifications/preferences" element={<NotificationPreferencesPage />} />

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
