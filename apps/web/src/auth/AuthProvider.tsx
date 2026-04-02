import React, { createContext, useContext, useEffect, useState } from 'react';
import type { KeycloakInstance } from 'keycloak-js';
import keycloak from './keycloak.js';

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  token: string | undefined;
  keycloak: KeycloakInstance;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    keycloak
      .init({
        onLoad: 'login-required',
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
      keycloak.updateToken(60).catch(() => {
        keycloak.logout();
      });
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

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, token: keycloak.token, keycloak }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
