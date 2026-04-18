import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { acceptInvitationPublic } from '../../shared/api/invitations.js';
import type { AcceptInvitationResponse } from '@provenance/types';

type Stage = 'idle' | 'accepting' | 'success' | 'error';

/**
 * F10.3 — Public invitation acceptance page.
 *
 * Reached via an email link like /accept-invite?token=XXXX. The token is the
 * bearer authorization for the public acceptance endpoint; no Keycloak login
 * is required to reach this page. On success the backend returns a login URL
 * the invitee can use to complete sign-in (Keycloak will trigger UPDATE_PASSWORD
 * for newly-created users).
 */
export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AcceptInvitationResponse | null>(null);

  useEffect(() => {
    if (!token) {
      setStage('error');
      setError('Missing invitation token in URL.');
    }
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStage('accepting');
    setError(null);

    try {
      const trimmedFirst = firstName.trim();
      const trimmedLast = lastName.trim();
      const response = await acceptInvitationPublic(token, {
        ...(trimmedFirst ? { firstName: trimmedFirst } : {}),
        ...(trimmedLast ? { lastName: trimmedLast } : {}),
      });
      setResult(response);
      setStage('success');
    } catch (err) {
      const message = (err as Error).message || 'Failed to accept invitation';
      setError(message);
      setStage('error');
    }
  }

  if (stage === 'success' && result) {
    return (
      <CenteredShell>
        <div className="text-center">
          <div className="text-4xl mb-4">🎉</div>
          <h1 className="text-xl font-semibold text-slate-900">Invitation accepted</h1>
          <p className="mt-2 text-sm text-slate-500">
            Your account is ready. Sign in to continue — you'll be asked to set a password on your first login.
          </p>
          <a
            href={result.loginUrl}
            className="mt-6 inline-block px-5 py-2 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
          >
            Sign in to Provenance
          </a>
        </div>
      </CenteredShell>
    );
  }

  if (stage === 'error' && !token) {
    return (
      <CenteredShell>
        <h1 className="text-lg font-semibold text-slate-900">Invitation not found</h1>
        <p className="mt-2 text-sm text-slate-500">
          This invitation link is incomplete. Ask the person who invited you to send a new one.
        </p>
      </CenteredShell>
    );
  }

  return (
    <CenteredShell>
      <h1 className="text-xl font-semibold text-slate-900">You've been invited to Provenance</h1>
      <p className="mt-2 text-sm text-slate-500">
        Confirm your name below to accept the invitation. You'll set a password after accepting.
      </p>

      <form onSubmit={(e) => { void handleSubmit(e); }} className="mt-6 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name">
            <input
              type="text"
              className="input"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              maxLength={100}
              autoComplete="given-name"
            />
          </Field>
          <Field label="Last name">
            <input
              type="text"
              className="input"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              maxLength={100}
              autoComplete="family-name"
            />
          </Field>
        </div>

        {stage === 'error' && error && (
          <div className="rounded-md bg-red-50 p-3 border border-red-200 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={stage === 'accepting' || !token}
          className="w-full px-4 py-2 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {stage === 'accepting' ? 'Accepting invitation…' : 'Accept invitation'}
        </button>
      </form>
    </CenteredShell>
  );
}

function CenteredShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-lg border border-slate-200 p-8 shadow-sm">
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      {children}
    </div>
  );
}
