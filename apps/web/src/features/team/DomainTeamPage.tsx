import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { organizationsApi } from '../../shared/api/organizations.js';
import { invitationsApi } from '../../shared/api/invitations.js';
import type {
  Domain,
  Invitation,
  Member,
  RoleType,
} from '@provenance/types';

type Tab = 'members' | 'invitations';

/**
 * F7.22 / F10.4 — Domain team management UI.
 *
 * Lets domain owners view team members, invite new members by email, assign
 * domain-level roles, revoke access, and see pending invitations. Backed by
 * the organization members and invitations endpoints.
 */
export function DomainTeamPage() {
  const { orgId = '', domainId = '' } = useParams<{ orgId: string; domainId: string }>();

  const [domain, setDomain] = useState<Domain | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('members');

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, m, i] = await Promise.all([
        organizationsApi.domains.get(orgId, domainId),
        organizationsApi.members.list(orgId),
        invitationsApi.listForDomain(orgId, domainId),
      ]);
      setDomain(d);
      setMembers(m.items);
      setInvitations(i.items);
    } catch (err) {
      setError((err as Error).message ?? 'Failed to load team');
    } finally {
      setLoading(false);
    }
  }, [orgId, domainId]);

  useEffect(() => {
    if (orgId && domainId) {
      void loadAll();
    }
  }, [orgId, domainId, loadAll]);

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-sm text-slate-500">Loading team…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-md bg-red-50 p-4 border border-red-200 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <Link
          to={`/dashboard/${orgId}/domains/${domainId}`}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← Back to {domain?.name ?? 'domain'}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          {domain?.name ?? 'Domain'} — Team
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage members, pending invitations, and domain-level role assignments.
        </p>
      </div>

      <div className="border-b border-slate-200 mb-6">
        <nav className="-mb-px flex gap-6">
          <TabButton active={tab === 'members'} onClick={() => setTab('members')}>
            Members <span className="ml-1 text-xs text-slate-400">({members.length})</span>
          </TabButton>
          <TabButton active={tab === 'invitations'} onClick={() => setTab('invitations')}>
            Pending invitations <span className="ml-1 text-xs text-slate-400">({invitations.filter((i) => i.status === 'pending').length})</span>
          </TabButton>
        </nav>
      </div>

      {tab === 'members' ? (
        <MembersTab
          orgId={orgId}
          domainId={domainId}
          members={members}
          onChanged={loadAll}
        />
      ) : (
        <InvitationsTab
          orgId={orgId}
          invitations={invitations}
          onChanged={loadAll}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-1 py-3 border-b-2 text-sm font-medium transition-colors ${
        active
          ? 'border-brand-600 text-brand-700'
          : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Members tab — list + invite form + revoke action
// ---------------------------------------------------------------------------

function MembersTab({
  orgId,
  domainId,
  members,
  onChanged,
}: {
  orgId: string;
  domainId: string;
  members: Member[];
  onChanged: () => Promise<void>;
}) {
  void domainId; // preserved for future domain-scoped filters
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function handleRemove(principalId: string) {
    if (!confirm('Remove this member from the organization? Their access will be revoked immediately.')) {
      return;
    }
    setRemoving(principalId);
    setRemoveError(null);
    try {
      await organizationsApi.members.remove(orgId, principalId);
      await onChanged();
    } catch (err) {
      setRemoveError((err as Error).message ?? 'Failed to remove member');
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="space-y-6">
      <InviteMemberForm orgId={orgId} domainId={domainId} onInvited={onChanged} />

      {removeError && (
        <div className="rounded-md bg-red-50 p-3 border border-red-200 text-sm text-red-700">{removeError}</div>
      )}

      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>Joined</Th>
              <Th><span className="sr-only">Actions</span></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {members.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400 text-sm">
                  No members yet. Invite someone below.
                </td>
              </tr>
            )}
            {members.map((m) => (
              <tr key={`${m.principalId}-${m.role}`}>
                <Td>{m.displayName ?? '—'}</Td>
                <Td>{m.email ?? '—'}</Td>
                <Td>
                  <RolePill role={m.role} />
                </Td>
                <Td>{new Date(m.joinedAt).toLocaleDateString()}</Td>
                <Td>
                  <button
                    type="button"
                    onClick={() => { void handleRemove(m.principalId); }}
                    disabled={removing === m.principalId}
                    className="text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
                  >
                    {removing === m.principalId ? 'Removing…' : 'Revoke'}
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invite form
// ---------------------------------------------------------------------------

const ROLE_OPTIONS: { value: RoleType; label: string; description: string }[] = [
  { value: 'domain_owner', label: 'Domain owner', description: 'Manages the domain and its members.' },
  { value: 'data_product_owner', label: 'Data product owner', description: 'Authors and publishes data products.' },
  { value: 'consumer', label: 'Consumer', description: 'Discovers and requests access to data products.' },
];

function InviteMemberForm({
  orgId,
  domainId,
  onInvited,
}: {
  orgId: string;
  domainId: string;
  onInvited: () => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<RoleType>('data_product_owner');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      await invitationsApi.create(orgId, { email: email.trim(), role, domainId });
      setResult({ ok: true, message: `Invitation sent to ${email.trim()}.` });
      setEmail('');
      await onInvited();
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message ?? 'Failed to send invitation' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Invite a new member</h2>
      <p className="mt-1 text-xs text-slate-500">
        The invitee will receive an email with a time-limited acceptance link.
      </p>
      <form onSubmit={(e) => { void handleSubmit(e); }} className="mt-4 grid grid-cols-12 gap-3 items-end">
        <div className="col-span-5">
          <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
          <input
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="colleague@example.com"
          />
        </div>
        <div className="col-span-5">
          <label className="block text-xs font-medium text-slate-700 mb-1">Role</label>
          <select
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value as RoleType)}
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <button
            type="submit"
            disabled={submitting || !email.trim()}
            className="w-full px-3 py-2 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {submitting ? 'Sending…' : 'Send invite'}
          </button>
        </div>
      </form>
      {result && (
        <div
          className={`mt-3 rounded-md p-2 text-xs ${
            result.ok
              ? 'bg-green-50 border border-green-200 text-green-700'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}
        >
          {result.message}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invitations tab — pending, resend
// ---------------------------------------------------------------------------

function InvitationsTab({
  orgId,
  invitations,
  onChanged,
}: {
  orgId: string;
  invitations: Invitation[];
  onChanged: () => Promise<void>;
}) {
  const [resending, setResending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleResend(invitationId: string) {
    setResending(invitationId);
    setError(null);
    try {
      await invitationsApi.resend(orgId, invitationId);
      await onChanged();
    } catch (err) {
      setError((err as Error).message ?? 'Failed to resend invitation');
    } finally {
      setResending(null);
    }
  }

  if (invitations.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
        No pending invitations.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md bg-red-50 p-3 border border-red-200 text-sm text-red-700">{error}</div>
      )}
      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Expires</Th>
              <Th>Resends</Th>
              <Th><span className="sr-only">Actions</span></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {invitations.map((i) => (
              <tr key={i.id}>
                <Td>{i.email}</Td>
                <Td><RolePill role={i.role} /></Td>
                <Td><StatusPill status={i.status} /></Td>
                <Td>{new Date(i.expiresAt).toLocaleDateString()}</Td>
                <Td>{i.resendCount}</Td>
                <Td>
                  {i.status !== 'accepted' && (
                    <button
                      type="button"
                      onClick={() => { void handleResend(i.id); }}
                      disabled={resending === i.id}
                      className="text-sm text-brand-600 hover:text-brand-800 disabled:opacity-50"
                    >
                      {resending === i.id ? 'Sending…' : 'Resend'}
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 text-sm text-slate-700">{children}</td>;
}

function RolePill({ role }: { role: RoleType }) {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
      {role.replace(/_/g, ' ')}
    </span>
  );
}

function StatusPill({ status }: { status: Invitation['status'] }) {
  const styles: Record<Invitation['status'], string> = {
    pending: 'bg-amber-100 text-amber-800',
    accepted: 'bg-green-100 text-green-800',
    expired: 'bg-slate-100 text-slate-500',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}
