import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider.js';
import { meApi } from '../api/me.js';
import type { MeProfileResponse } from '@provenance/types';

function initialsFor(profile: MeProfileResponse | null): string {
  if (!profile) return '··';
  if (profile.displayName) {
    const parts = profile.displayName.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    if (parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase();
    return parts[0][0].toUpperCase();
  }
  if (profile.email) return profile.email.slice(0, 2).toUpperCase();
  return '··';
}

// F7.48 — sidebar-bottom avatar dropdown. Sits where the prior naked
// "Sign out" button lived. Click to expand a small menu with "Account"
// (routes to /account) and "Sign out". Mounted by NavShell.
export function UserMenu() {
  const { keycloak } = useAuth();
  const [profile, setProfile] = useState<MeProfileResponse | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    meApi
      .getProfile()
      .then((p) => { if (!cancelled) setProfile(p); })
      .catch(() => { /* leave profile null — UserMenu still renders with fallback initials */ });
    return () => { cancelled = true; };
  }, []);

  // Click-outside + Escape close the dropdown.
  useEffect(() => {
    if (!open) return;
    const handlePointer = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const initials = initialsFor(profile);
  const displayName = profile?.displayName ?? profile?.email ?? 'Account';
  const subtext = profile?.org?.name ?? '';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-2 py-2 rounded-md text-left hover:bg-slate-800 transition-colors"
      >
        <span
          className="w-9 h-9 rounded-full bg-brand-600 text-white flex items-center justify-center text-sm font-semibold flex-shrink-0"
          aria-hidden
        >
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-white truncate">{displayName}</span>
          {subtext && (
            <span className="block text-xs text-slate-400 truncate">{subtext}</span>
          )}
        </span>
        <svg
          className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-lg shadow-lg border border-slate-200 overflow-hidden z-10"
        >
          <Link
            to="/account"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Account
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); void keycloak.logout(); }}
            className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 border-t border-slate-100"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
