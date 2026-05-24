import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider.js';
import { meApi } from '../../shared/api/me.js';
import type { MeProfileResponse } from '@provenance/types';

const ROLE_LABELS: Record<string, string> = {
  org_admin: 'Org admin',
  domain_owner: 'Domain owner',
  data_product_owner: 'Data product owner',
  consumer: 'Consumer',
  governance_member: 'Governance member',
  platform_admin: 'Platform admin',
  platform_observer: 'Platform observer',
};

const PRINCIPAL_TYPE_LABELS: Record<string, string> = {
  human_user: 'Human user',
  service_account: 'Service account',
  ai_agent: 'AI agent',
  platform_admin: 'Platform admin',
};

function initialsFor(profile: MeProfileResponse): string {
  if (profile.displayName) {
    const parts = profile.displayName.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    if (parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase();
    return parts[0][0].toUpperCase();
  }
  if (profile.email) return profile.email.slice(0, 2).toUpperCase();
  return '?';
}

// F7.48 — Provenance Account Surface. Read-only profile + change-password
// + sign-out. In-app edit of display name/email, profile photo, notification
// preferences, and multi-org switcher are all explicitly out of scope for
// this iteration (see PRD F7.48).
export function AccountPage() {
  const { keycloak } = useAuth();
  const [profile, setProfile] = useState<MeProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  useEffect(() => {
    let cancelled = false;
    meApi
      .getProfile()
      .then((p) => {
        if (!cancelled) {
          setProfile(p);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load profile');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const handleChangePassword = (): void => {
    // Keycloak supports kc_action=UPDATE_PASSWORD to deep-link into the
    // password-change flow inside the hosted account console. We use the
    // built-in keycloak.login() with the action override — that's the
    // documented way (no need to construct the URL by hand or guess the
    // realm path). User returns to /account after success.
    void keycloak.login({
      action: 'UPDATE_PASSWORD',
      redirectUri: window.location.href,
    });
  };

  const handleSignOut = (): void => {
    void keycloak.logout();
  };

  const handleCopyPrincipalId = async (): Promise<void> => {
    if (!profile) return;
    try {
      await navigator.clipboard.writeText(profile.principalId);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      // Clipboard API can fail in restricted contexts; silently no-op.
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold text-slate-900">Your account</h1>
        <div className="mt-4 p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error ?? 'Profile not available.'}
        </div>
      </div>
    );
  }

  const initials = initialsFor(profile);
  const principalTypeLabel = PRINCIPAL_TYPE_LABELS[profile.principalType] ?? profile.principalType;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold text-slate-900 mb-6">Your account</h1>

      {/* Identity header card */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xl font-semibold flex-shrink-0"
            aria-hidden
          >
            {initials}
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900 truncate">
              {profile.displayName ?? profile.email ?? 'Unnamed user'}
            </h2>
            {profile.email && (
              <p className="text-sm text-slate-500 truncate">{profile.email}</p>
            )}
            <p className="text-xs text-slate-400 mt-1">{principalTypeLabel}</p>
          </div>
        </div>
      </div>

      {/* Identity details */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Identity</h3>
        <dl className="space-y-4 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Organisation</dt>
            <dd className="mt-1 text-slate-900">
              {profile.org.name}{' '}
              <span className="text-xs text-slate-400 font-mono">({profile.org.slug})</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Roles</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {profile.roles.length === 0 ? (
                <span className="text-slate-400 text-xs">No roles assigned</span>
              ) : (
                profile.roles.map((r) => (
                  <span
                    key={r}
                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200"
                  >
                    {ROLE_LABELS[r] ?? r}
                  </span>
                ))
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Principal ID</dt>
            <dd className="mt-1 flex items-center gap-2">
              <code className="text-xs font-mono text-slate-500 bg-slate-50 px-2 py-1 rounded border border-slate-200 truncate">
                {profile.principalId}
              </code>
              <button
                type="button"
                onClick={() => void handleCopyPrincipalId()}
                className="text-xs text-brand-600 hover:text-brand-700 font-medium"
              >
                {copyState === 'copied' ? 'Copied' : 'Copy'}
              </button>
            </dd>
          </div>
        </dl>
      </section>

      {/* Actions */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Actions</h3>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleChangePassword}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
          >
            Change password
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
          >
            Sign out
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-3">
          Changing your password redirects to the Provenance identity provider and back.
          Editing your display name or email isn&apos;t available here yet.
        </p>
      </section>
    </div>
  );
}
