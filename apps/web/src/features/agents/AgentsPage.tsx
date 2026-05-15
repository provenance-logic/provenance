import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { organizationsApi } from '../../shared/api/organizations.js';
import { agentsApi, type AgentResponse } from '../../shared/api/agents.js';
import type { Organization } from '@provenance/types';

// F7.46 follow-on (B-026) — Agents page.
//
// Lists every AI agent registered against the user's organization with
// its trust classification, model, and human oversight contact. Provides
// a registration form whose success state surfaces the Keycloak client
// secret exactly once (the API only returns it on create); the operator
// is responsible for copying it before navigating away.
//
// Trust-classification mutations (Observed → Supervised → Autonomous)
// live behind PATCH /agents/:agentId/classification with their own role
// gates and are deferred to a follow-on PR — listing + registration are
// the F7.46 wizard's needs.

const MODEL_PROVIDER_OPTIONS = [
  { value: 'anthropic',  label: 'Anthropic' },
  { value: 'openai',     label: 'OpenAI' },
  { value: 'google',     label: 'Google' },
  { value: 'mistral',    label: 'Mistral' },
  { value: 'other',      label: 'Other' },
];

const CLASSIFICATION_COLOR: Record<AgentResponse['current_classification'], string> = {
  Observed:    'bg-slate-100 text-slate-700',
  Supervised:  'bg-amber-100 text-amber-800',
  Autonomous:  'bg-violet-100 text-violet-800',
};

export function AgentsPage() {
  const [org, setOrg] = useState<Organization | null>(null);
  const [agents, setAgents] = useState<AgentResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<{ agent: AgentResponse; secret: string } | null>(null);

  const loadAgents = useCallback(async (orgId: string) => {
    const list = await agentsApi.list(orgId);
    setAgents(list);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      setError(null);
      try {
        const orgs = await organizationsApi.list(1, 0);
        if (cancelled) return;
        if (orgs.items.length === 0) {
          setError('You are not a member of any organization yet.');
          return;
        }
        const orgData = orgs.items[0];
        setOrg(orgData);
        await loadAgents(orgData.id);
      } catch (err) {
        if (!cancelled) setError((err as Error).message ?? 'Failed to load agents');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void init();
    return () => { cancelled = true; };
  }, [loadAgents]);

  if (loading) {
    return <div className="p-8"><p className="text-sm text-slate-500">Loading agents…</p></div>;
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-md bg-red-50 p-4 border border-red-200 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  if (!org) return null;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <Link to="/dashboard" className="text-sm text-slate-500 hover:text-slate-700">← Back to dashboard</Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Agents</h1>
        <p className="mt-1 text-sm text-slate-500">
          AI agents registered against <span className="font-medium text-slate-700">{org.name}</span>. Every MCP tool call an agent makes is audited under its identity and gated by its current trust classification. New agents start at <span className="font-medium">Observed</span>; upgrades require a governance role, downgrades require the oversight contact or governance.
        </p>
      </div>

      {newSecret && (
        <NewAgentSecretBanner
          agent={newSecret.agent}
          secret={newSecret.secret}
          onDismiss={() => setNewSecret(null)}
        />
      )}

      <div className="space-y-6">
        <RegisterAgentForm
          orgId={org.id}
          onRegistered={async (agent) => {
            if (agent.keycloak_client_secret) {
              setNewSecret({ agent, secret: agent.keycloak_client_secret });
            }
            await loadAgents(org.id);
          }}
        />

        <AgentTable agents={agents} />
      </div>
    </div>
  );
}

function AgentTable({ agents }: { agents: AgentResponse[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            <Th>Display name</Th>
            <Th>Model</Th>
            <Th>Classification</Th>
            <Th>Oversight</Th>
            <Th>Registered</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {agents.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-slate-400 text-sm">
                No agents registered yet. Use the form above to register one — or have an agent self-register via the MCP <code className="text-xs">register_agent</code> tool.
              </td>
            </tr>
          )}
          {agents.map((a) => (
            <tr key={a.agent_id}>
              <Td>
                <div className="font-medium text-slate-900">{a.display_name}</div>
                <div className="text-xs text-slate-400 font-mono">{a.agent_id.slice(0, 8)}…</div>
              </Td>
              <Td>
                <div>{a.model_name}</div>
                <div className="text-xs text-slate-400">{a.model_provider}</div>
              </Td>
              <Td>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${CLASSIFICATION_COLOR[a.current_classification]}`}>
                  {a.current_classification}
                </span>
              </Td>
              <Td>
                <span className="text-xs text-slate-600">{a.human_oversight_contact}</span>
              </Td>
              <Td>{new Date(a.created_at).toLocaleDateString()}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RegisterAgentForm({
  orgId,
  onRegistered,
}: {
  orgId: string;
  onRegistered: (agent: AgentResponse) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState('');
  const [modelName, setModelName] = useState('');
  const [modelProvider, setModelProvider] = useState<string>('anthropic');
  const [oversightEmail, setOversightEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const agent = await agentsApi.register({
        display_name: displayName.trim(),
        model_name: modelName.trim(),
        model_provider: modelProvider,
        human_oversight_contact: oversightEmail.trim(),
        org_id: orgId,
      });
      setDisplayName('');
      setModelName('');
      setModelProvider('anthropic');
      setOversightEmail('');
      await onRegistered(agent);
    } catch (err) {
      setError((err as Error).message ?? 'Failed to register agent');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Register an agent</h2>
      <p className="mt-1 text-xs text-slate-500">
        The agent will be created with a fresh Keycloak client. Its client secret is shown <span className="font-medium">once</span>, after registration — copy it then. Trust classification starts at <span className="font-medium">Observed</span>.
      </p>
      <form onSubmit={(e) => { void handleSubmit(e); }} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Display name">
          <input
            className="input w-full"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Claims triage agent"
            required
          />
        </Field>
        <Field label="Model name">
          <input
            className="input w-full"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            placeholder="e.g. claude-sonnet-4-6"
            required
          />
        </Field>
        <Field label="Model provider">
          <select
            className="input w-full"
            value={modelProvider}
            onChange={(e) => setModelProvider(e.target.value)}
          >
            {MODEL_PROVIDER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </Field>
        <Field
          label="Human oversight contact (email)"
          hint="Must be a registered platform user. They can downgrade this agent's trust classification without a governance role."
        >
          <input
            type="email"
            className="input w-full"
            value={oversightEmail}
            onChange={(e) => setOversightEmail(e.target.value)}
            placeholder="oversight@example.com"
            required
          />
        </Field>
        <div className="md:col-span-2 flex items-center justify-between gap-3">
          {error && <div className="text-xs text-red-600 flex-1">{error}</div>}
          <button
            type="submit"
            disabled={submitting}
            className="px-3 py-2 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {submitting ? 'Registering…' : 'Register agent'}
          </button>
        </div>
      </form>
    </div>
  );
}

function NewAgentSecretBanner({
  agent,
  secret,
  onDismiss,
}: {
  agent: AgentResponse;
  secret: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API may be unavailable on insecure origins; user can still copy by hand
    }
  }

  return (
    <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-amber-900">
            Agent <span className="font-mono">{agent.display_name}</span> registered — copy the client secret now
          </h3>
          <p className="mt-1 text-xs text-amber-800">
            This secret is shown <span className="font-medium">once</span>. Provenance never stores it in plaintext, so it cannot be retrieved later. If you lose it, use <span className="font-mono">POST /agents/{agent.agent_id}/rotate-secret</span> to mint a new one.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="block flex-1 break-all rounded bg-white px-2 py-1 text-xs text-slate-800 border border-amber-200 font-mono">
              {secret}
            </code>
            <button
              type="button"
              onClick={() => { void copy(); }}
              className="px-2 py-1 rounded-md bg-amber-700 text-white text-xs font-medium hover:bg-amber-800"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="mt-2 text-xs text-amber-800">
            Client ID: <span className="font-mono">{agent.keycloak_client_id}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-amber-700 hover:text-amber-900 text-sm"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
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
  return <td className="px-4 py-3 text-sm text-slate-700 align-top">{children}</td>;
}
