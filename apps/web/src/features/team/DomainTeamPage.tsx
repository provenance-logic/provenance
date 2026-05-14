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

  // F7.22: load three lists in parallel —
  //   - domain metadata,
  //   - members WITH domain-scoped role assignments only (was previously
  //     showing every org-scoped member, which was the bug),
  //   - org members (any scope) so the "assign existing member" form
  //     can offer the picker without forcing an invitation roundtrip.
  // Invitations remain domain-scoped via the existing endpoint.
  const [orgMembers, setOrgMembers] = useState<Member[]>([]);
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, m, om, i] = await Promise.all([
        organizationsApi.domains.get(orgId, domainId),
        organizationsApi.members.listForDomain(orgId, domainId),
        organizationsApi.members.list(orgId),
        invitationsApi.listForDomain(orgId, domainId),
      ]);
      setDomain(d);
      setMembers(m.items);
      setOrgMembers(om.items);
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
          orgMembers={orgMembers}
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
  orgMembers,
  onChanged,
}: {
  orgId: string;
  domainId: string;
  members: Member[];
  orgMembers: Member[];
  onChanged: () => Promise<void>;
}) {
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  // F7.22: revoke removes one (principal, role, domain) row rather than
  // the principal's entire membership. Stripping all org-wide
  // assignments from a Domain Team page would be a destructive bug.
  async function handleRevokeRole(principalId: string, role: string) {
    if (!confirm(`Revoke '${role.replace(/_/g, ' ')}' from this member for this domain? Their other roles and other domain memberships are unaffected.`)) {
      return;
    }
    const key = `${principalId}:${role}`;
    setRevoking(key);
    setRevokeError(null);
    try {
      await organizationsApi.members.removeRoleForDomain(orgId, domainId, principalId, role);
      await onChanged();
    } catch (err) {
      setRevokeError((err as Error).message ?? 'Failed to revoke role');
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <AssignExistingMemberForm
          orgId={orgId}
          domainId={domainId}
          orgMembers={orgMembers}
          domainMembers={members}
          onChanged={onChanged}
        />
        <InviteMemberForm orgId={orgId} domainId={domainId} onInvited={onChanged} />
      </div>

      {revokeError && (
        <div className="rounded-md bg-red-50 p-3 border border-red-200 text-sm text-red-700">{revokeError}</div>
      )}

      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>Granted</Th>
              <Th><span className="sr-only">Actions</span></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {members.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400 text-sm">
                  No domain members yet. Use the forms above to assign a role or invite by email.
                </td>
              </tr>
            )}
            {members.map((m) => {
              const key = `${m.principalId}:${m.role}`;
              return (
                <tr key={key}>
                  <Td>{m.displayName ?? '—'}</Td>
                  <Td>{m.email ?? '—'}</Td>
                  <Td>
                    <RolePill role={m.role} />
                  </Td>
                  <Td>{new Date(m.joinedAt).toLocaleDateString()}</Td>
                  <Td>
                    <button
                      type="button"
                      onClick={() => { void handleRevokeRole(m.principalId, m.role); }}
                      disabled={revoking === key}
                      className="text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
                    >
                      {revoking === key ? 'Revoking…' : 'Revoke'}
                    </button>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// F7.22 — assign an existing org member to a domain role. Mirrors the
// OrgRolesPage assignment form. Filters the picker to org members who
// don't already hold the chosen role in this domain.
function AssignExistingMemberForm({
  orgId,
  domainId,
  orgMembers,
  domainMembers,
  onChanged,
}: {
  orgId: string;
  domainId: string;
  orgMembers: Member[];
  domainMembers: Member[];
  onChanged: () => Promise<void>;
}) {
  const [principalId, setPrincipalId] = useState('');
  const [role, setRole] = useState<RoleType>('data_product_owner');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Deduplicate the picker by principalId so a person with multiple
  // org-level roles doesn't appear twice.
  const principals = React.useMemo(() => {
    const seen = new Map<string, Member>();
    for (const m of orgMembers) {
      if (!seen.has(m.principalId)) seen.set(m.principalId, m);
    }
    return Array.from(seen.values()).sort((a, b) =>
      (a.displayName ?? a.email ?? '').localeCompare(b.displayName ?? b.email ?? ''),
    );
  }, [orgMembers]);

  const alreadyInDomain = React.useMemo(() => {
    const set = new Set<string>();
    for (const m of domainMembers) {
      set.add(`${m.principalId}:${m.role}`);
    }
    return set;
  }, [domainMembers]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!principalId) return;
    setSubmitting(true);
    setResult(null);
    try {
      const target = principals.find((p) => p.principalId === principalId);
      await organizationsApi.members.addForDomain(orgId, domainId, {
        principalId,
        principalType: target?.principalType ?? 'human_user',
        role,
      });
      setResult({ ok: true, message: 'Role assigned to this domain.' });
      setPrincipalId('');
      await onChanged();
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message ?? 'Failed to assign role' });
    } finally {
      setSubmitting(false);
    }
  }

  const wouldDuplicate = principalId && alreadyInDomain.has(`${principalId}:${role}`);

  return (
    <div className="rounded-md border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Assign an existing org member</h2>
      <p className="mt-1 text-xs text-slate-500">
        Grant a current member of this organization a role in this domain. They keep any other roles they already hold.
      </p>
      <form onSubmit={(e) => { void handleSubmit(e); }} className="mt-4 space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Org member</label>
          <select
            className="input w-full"
            value={principalId}
            onChange={(e) => setPrincipalId(e.target.value)}
            required
          >
            <option value="" disabled>Select a member…</option>
            {principals.map((p) => (
              <option key={p.principalId} value={p.principalId}>
                {(p.displayName ?? p.email ?? p.principalId)}{p.email && p.displayName ? ` — ${p.email}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Role</label>
          <select
            className="input w-full"
            value={role}
            onChange={(e) => setRole(e.target.value as RoleType)}
          >
            <option value="domain_owner">Domain owner</option>
            <option value="data_product_owner">Data product owner</option>
            <option value="consumer">Consumer</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={submitting || !principalId || Boolean(wouldDuplicate)}
          className="w-full px-3 py-2 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {submitting ? 'Assigning…' : wouldDuplicate ? 'Already in this domain at this role' : 'Assign role'}
        </button>
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
