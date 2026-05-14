import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { organizationsApi } from '../../shared/api/organizations.js';
import { invitationsApi } from '../../shared/api/invitations.js';
import type { Member, RoleType } from '@provenance/types';

// F7.7 — Organization-level Role Assignment UI.
//
// Lists every org-level role assignment (domainId IS NULL) for the
// organization, grouped per principal so a person with multiple
// org-level roles is one row with multiple pills. Org admins can
// assign a new org-level role to an existing member, revoke a single
// org-level role, or invite a new email at an org-level role (reusing
// the existing invitation flow).
//
// Two deferrals tracked in the PR description:
//   1. PRD F7.7 names "Platform Admin" / "Platform Observer" — for v1
//      we treat the existing `org_admin` as Platform Admin and skip
//      Platform Observer. No new roles in the enum.
//   2. PRD F7.7 says governance role assignment requires governance
//      acknowledgment — deferred; `governance_member` is assigned like
//      any other role for now.

type GroupedMember = {
  principalId: string;
  email: string | null;
  displayName: string | null;
  joinedAt: string;
  roles: RoleType[];
};

const ROLE_OPTIONS: { value: RoleType; label: string; description: string }[] = [
  { value: 'org_admin', label: 'Org admin', description: 'Full platform-level admin within this organization.' },
  { value: 'governance_member', label: 'Governance member', description: 'Authors policies and reviews governance decisions.' },
  { value: 'data_product_owner', label: 'Data product owner', description: 'Authors and publishes data products.' },
  { value: 'consumer', label: 'Consumer', description: 'Discovers and requests access to data products.' },
];

export function OrgRolesPage() {
  const { orgId = '' } = useParams<{ orgId: string }>();

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const m = await organizationsApi.members.list(orgId);
      setMembers(m.items);
    } catch (err) {
      setError((err as Error).message ?? 'Failed to load members');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (orgId) {
      void loadMembers();
    }
  }, [orgId, loadMembers]);

  const grouped = useMemo<GroupedMember[]>(() => {
    const orgLevel = members.filter((m) => m.domainId === null);
    const byPrincipal = new Map<string, GroupedMember>();
    for (const m of orgLevel) {
      const existing = byPrincipal.get(m.principalId);
      if (existing) {
        if (!existing.roles.includes(m.role)) existing.roles.push(m.role);
        if (m.joinedAt < existing.joinedAt) existing.joinedAt = m.joinedAt;
      } else {
        byPrincipal.set(m.principalId, {
          principalId: m.principalId,
          email: m.email,
          displayName: m.displayName,
          joinedAt: m.joinedAt,
          roles: [m.role],
        });
      }
    }
    return Array.from(byPrincipal.values()).sort((a, b) =>
      (a.displayName ?? a.email ?? '').localeCompare(b.displayName ?? b.email ?? ''),
    );
  }, [members]);

  if (loading) {
    return <div className="p-8"><p className="text-sm text-slate-500">Loading roles…</p></div>;
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
        <Link to={`/dashboard`} className="text-sm text-slate-500 hover:text-slate-700">← Back to dashboard</Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Organization roles</h1>
        <p className="mt-1 text-sm text-slate-500">
          Assign and revoke organization-level role assignments. Domain-level role assignments live on each domain&rsquo;s Team page.
        </p>
      </div>

      <div className="space-y-6">
        <AssignmentForms orgId={orgId} members={members} onChanged={loadMembers} />

        <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Org-level roles</Th>
                <Th>First granted</Th>
                <Th><span className="sr-only">Actions</span></Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {grouped.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400 text-sm">
                    No org-level role assignments yet. Use the form above to assign one.
                  </td>
                </tr>
              )}
              {grouped.map((g) => (
                <PrincipalRow
                  key={g.principalId}
                  orgId={orgId}
                  principal={g}
                  onChanged={loadMembers}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PrincipalRow({
  orgId,
  principal,
  onChanged,
}: {
  orgId: string;
  principal: GroupedMember;
  onChanged: () => Promise<void>;
}) {
  const [revoking, setRevoking] = useState<RoleType | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRevoke(role: RoleType) {
    if (!confirm(`Revoke '${role.replace(/_/g, ' ')}' from ${principal.displayName ?? principal.email}? They will lose this org-level permission immediately.`)) {
      return;
    }
    setRevoking(role);
    setError(null);
    try {
      await organizationsApi.members.removeRole(orgId, principal.principalId, role);
      await onChanged();
    } catch (err) {
      setError((err as Error).message ?? 'Failed to revoke role');
    } finally {
      setRevoking(null);
    }
  }

  return (
    <tr>
      <Td>{principal.displayName ?? '—'}</Td>
      <Td>{principal.email ?? '—'}</Td>
      <Td>
        <div className="flex flex-wrap gap-1">
          {principal.roles.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => { void handleRevoke(r); }}
              disabled={revoking === r}
              title={`Click to revoke ${r.replace(/_/g, ' ')}`}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
            >
              {r.replace(/_/g, ' ')}
              <span className="text-slate-400">×</span>
            </button>
          ))}
        </div>
        {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
      </Td>
      <Td>{new Date(principal.joinedAt).toLocaleDateString()}</Td>
      <Td>{revoking ? <span className="text-xs text-slate-400">Revoking…</span> : null}</Td>
    </tr>
  );
}

function AssignmentForms({
  orgId,
  members,
  onChanged,
}: {
  orgId: string;
  members: Member[];
  onChanged: () => Promise<void>;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <AssignToExistingForm orgId={orgId} members={members} onChanged={onChanged} />
      <InviteByEmailForm orgId={orgId} onChanged={onChanged} />
    </div>
  );
}

function AssignToExistingForm({
  orgId,
  members,
  onChanged,
}: {
  orgId: string;
  members: Member[];
  onChanged: () => Promise<void>;
}) {
  // The principal picker draws from anyone who already exists in the
  // org (any role, any scope). Deduplicate so a domain owner who also
  // has consumer doesn't appear twice in the picker.
  const principals = useMemo(() => {
    const seen = new Map<string, Member>();
    for (const m of members) {
      if (!seen.has(m.principalId)) seen.set(m.principalId, m);
    }
    return Array.from(seen.values()).sort((a, b) =>
      (a.displayName ?? a.email ?? '').localeCompare(b.displayName ?? b.email ?? ''),
    );
  }, [members]);

  const [principalId, setPrincipalId] = useState<string>('');
  const [role, setRole] = useState<RoleType>('consumer');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!principalId) return;
    setSubmitting(true);
    setResult(null);
    try {
      const target = principals.find((p) => p.principalId === principalId);
      await organizationsApi.members.add(orgId, {
        principalId,
        principalType: target?.principalType ?? 'human_user',
        role,
      });
      setResult({ ok: true, message: 'Role assigned.' });
      setPrincipalId('');
      await onChanged();
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message ?? 'Failed to assign role' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Assign role to existing member</h2>
      <p className="mt-1 text-xs text-slate-500">Pick a current org member and grant them an org-level role.</p>
      <form onSubmit={(e) => { void handleSubmit(e); }} className="mt-4 space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Member</label>
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
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">{ROLE_OPTIONS.find((o) => o.value === role)?.description}</p>
        </div>
        <button
          type="submit"
          disabled={submitting || !principalId}
          className="w-full px-3 py-2 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {submitting ? 'Assigning…' : 'Assign role'}
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

function InviteByEmailForm({
  orgId,
  onChanged,
}: {
  orgId: string;
  onChanged: () => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<RoleType>('consumer');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      await invitationsApi.create(orgId, { email: email.trim(), role });
      setResult({ ok: true, message: `Invitation sent to ${email.trim()}.` });
      setEmail('');
      await onChanged();
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message ?? 'Failed to send invitation' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Invite a new member at this role</h2>
      <p className="mt-1 text-xs text-slate-500">Sends an email invitation; the role is bound when the invitee accepts.</p>
      <form onSubmit={(e) => { void handleSubmit(e); }} className="mt-4 space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
          <input
            type="email"
            className="input w-full"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="colleague@example.com"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Role</label>
          <select
            className="input w-full"
            value={role}
            onChange={(e) => setRole(e.target.value as RoleType)}
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={submitting || !email.trim()}
          className="w-full px-3 py-2 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {submitting ? 'Sending…' : 'Send invite'}
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
