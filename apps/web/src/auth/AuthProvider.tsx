import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { KeycloakInstance } from 'keycloak-js';
import keycloak from './keycloak.js';

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  token: string | undefined;
  keycloak: KeycloakInstance;
  /**
   * Platform principal id (identity.principals.id). Read from the
   * provenance_principal_id JWT claim (populated by the Keycloak protocol
   * mapper). Falls back to the Keycloak sub if the claim is missing — useful
   * for dev/bootstrap flows where the mapper has no attribute value yet,
   * though downstream DB lookups will not match in that case.
   */
  principalId: string | undefined;
  /**
   * Caller's bound organisation id. Read from the `provenance_org_id` JWT
   * claim. Empty until the user has completed self-serve onboarding (the
   * `RequireOrg` wrapper redirects to `/onboarding/org` in that case).
   */
  orgId: string | undefined;
  /**
   * Kick off a Keycloak login redirect. Protected pages call this when the
   * user is not authenticated.
   */
  login: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Routes that render without forcing a Keycloak login. Self-serve signup
 * (F10.1) and invitation acceptance (F10.3) must be reachable by users who
 * do not yet have a Keycloak session. Every other route goes through the
 * RequireAuth wrapper which redirects to login on demand.
 */
const PUBLIC_PATH_PREFIXES = ['/accept-invite'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Public paths use check-sso (never forces a redirect) so an unauthenticated
    // visitor can reach /accept-invite?token=... without first signing in.
    // Everything else redirects to the Keycloak login page immediately.
    const onLoad: 'login-required' | 'check-sso' = isPublicPath(window.location.pathname)
      ? 'check-sso'
      : 'login-required';

    keycloak
      .init({
        onLoad,
        checkLoginIframe: false,
      })
      .then((authenticated) => {
        setIsAuthenticated(authenticated);
        setIsLoading(false);
      })
      .catch(() => {
        setIsLoading(false);
      });

    // Refresh token before expiry.
    const refreshInterval = setInterval(() => {
      if (keycloak.authenticated) {
        void keycloak.updateToken(60).catch(() => {
          void keycloak.logout();
        });
      }
    }, 30_000);

    return () => clearInterval(refreshInterval);
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent mx-auto" />
          <p className="mt-4 text-sm text-slate-500">Authenticating…</p>
        </div>
      </div>
    );
  }

  const tokenParsed = keycloak.tokenParsed as
    | { sub?: string; provenance_principal_id?: string; provenance_org_id?: string }
    | undefined;
  const principalId = tokenParsed?.provenance_principal_id ?? tokenParsed?.sub;
  const orgId = tokenParsed?.provenance_org_id;

  const login = () => {
    void keycloak.login({ redirectUri: window.location.href });
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, token: keycloak.token, keycloak, principalId, orgId, login }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/**
 * Wraps protected routes. Redirects to the Keycloak login page if the user
 * is not authenticated. Used by the AppRouter to gate everything except the
 * listed PUBLIC_PATH_PREFIXES.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, login } = useAuth();
  useEffect(() => {
    if (!isAuthenticated) login();
  }, [isAuthenticated, login]);

  if (!isAuthenticated) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500">Redirecting to sign in…</p>
      </div>
    );
  }
  return <>{children}</>;
}

/**
 * Paths that are allowed to render without a bound organization. Everything
 * else is tenant-scoped and will 401 on the API side (JwtAuthGuard requires
 * a non-empty provenance_org_id claim on every route except @AllowNoOrg).
 */
const NO_ORG_PATH_PREFIXES = ['/onboarding/'];

/**
 * Redirects authenticated users whose JWT has no `provenance_org_id` claim
 * (newly registered, not yet self-served) to `/onboarding/org`, so they
 * cannot land on a route that would fire tenant-scoped API calls.
 *
 * The JWT claim is the single source of truth for org membership — reading
 * it here avoids a chicken-and-egg API call against the tenant-scoped
 * organizations endpoint to discover "do I have an org?".
 */
export function RequireOrg({ children }: { children: React.ReactNode }) {
  const { keycloak } = useAuth();
  const location = useLocation();

  const orgId = (keycloak.tokenParsed as { provenance_org_id?: string } | undefined)
    ?.provenance_org_id;

  const isOnboardingPath = NO_ORG_PATH_PREFIXES.some((p) => location.pathname.startsWith(p));

  if (!orgId && !isOnboardingPath) {
    return <Navigate to="/onboarding/org" replace />;
  }
  return <>{children}</>;
}
