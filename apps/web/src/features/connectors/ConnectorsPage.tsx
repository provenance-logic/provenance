import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { organizationsApi } from '../../shared/api/organizations.js';
import { connectorsApi } from '../../shared/api/connectors.js';
import type {
  Connector,
  ConnectorType,
  Domain,
  Organization,
  ValidationStatus,
} from '@provenance/types';

// F7.46 follow-on (B-025) — Connectors page.
//
// Lists every connector registered for the active org and exposes a
// registration form bound to POST /organizations/:orgId/connectors. The
// form deliberately surfaces connectionConfig as a JSON textarea
// (default `{}`) rather than rendering connector-type-specific forms —
// per-type field schemas are a follow-on once the operator UX for
// credentials is settled. credentialArn is a free-text field so the
// operator can paste an AWS Secrets Manager ARN; raw credentials never
// hit the UI.

// Per PRD F3.2 + F3.2a (2026-05-23 PRD v1.6 reshape closing anchor
// decision 5 on B-063): the dropdown exposes only types that ship
// end-to-end at the consumer-grade bar. Earlier versions advertised 13
// options; the 10 unimplemented options were retired. Snowflake is the
// next-scheduled addition under the F3.2a tranche cadence.
const CONNECTOR_TYPES: { value: ConnectorType; label: string }[] = [
  { value: 'postgresql',  label: 'PostgreSQL' },
  { value: 'databricks',  label: 'Databricks' },
  { value: 's3',          label: 'S3' },
];

const VALIDATION_PILL: Record<ValidationStatus, string> = {
  pending:  'bg-slate-100 text-slate-700',
  valid:    'bg-green-100 text-green-800',
  invalid:  'bg-red-100 text-red-800',
  stale:    'bg-amber-100 text-amber-800',
};

export function ConnectorsPage() {
  const [org, setOrg] = useState<Organization | null>(null);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadConnectors = useCallback(async (orgId: string) => {
    const list = await connectorsApi.list(orgId);
    setConnectors(list.items);
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
        const [domainList] = await Promise.all([
          organizationsApi.domains.list(orgData.id),
          loadConnectors(orgData.id),
        ]);
        if (cancelled) return;
        setDomains(domainList.items);
      } catch (err) {
        if (!cancelled) setError((err as Error).message ?? 'Failed to load connectors');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void init();
    return () => { cancelled = true; };
  }, [loadConnectors]);

  if (loading) {
    return <div className="p-8"><p className="text-sm text-slate-500">Loading connectors…</p></div>;
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
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Connectors</h1>
        <p className="mt-1 text-sm text-slate-500">
          Connectors register your existing data systems against a domain inside <span className="font-medium text-slate-700">{org.name}</span> so lineage and access can flow through Provenance. Credentials are referenced by AWS Secrets Manager ARN — raw secrets never enter the platform.
        </p>
      </div>

      <div className="space-y-6">
        {domains.length === 0 ? (
          <div className="rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600">
            You need at least one domain before you can register a connector.{' '}
            <Link to={`/onboarding/domain?orgId=${org.id}`} className="text-brand-600 hover:text-brand-700 font-medium">
              Create your first domain →
            </Link>
          </div>
        ) : (
          <RegisterConnectorForm
            orgId={org.id}
            domains={domains}
            onRegistered={() => loadConnectors(org.id)}
          />
        )}

        <ConnectorTable connectors={connectors} domains={domains} />
      </div>
    </div>
  );
}

function ConnectorTable({
  connectors,
  domains,
}: {
  connectors: Connector[];
  domains: Domain[];
}) {
  const domainNameById = new Map(domains.map((d) => [d.id, d.name]));

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            <Th>Name</Th>
            <Th>Type</Th>
            <Th>Domain</Th>
            <Th>Validation</Th>
            <Th>Registered</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {connectors.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-slate-400 text-sm">
                No connectors registered yet. Use the form above to register one.
              </td>
            </tr>
          )}
          {connectors.map((c) => (
            <tr key={c.id}>
              <Td>
                <div className="font-medium text-slate-900">{c.name}</div>
                {c.description && (
                  <div className="text-xs text-slate-500 line-clamp-1">{c.description}</div>
                )}
              </Td>
              <Td>
                <span className="text-xs uppercase tracking-wide text-slate-600">
                  {CONNECTOR_TYPES.find((t) => t.value === c.connectorType)?.label ?? c.connectorType}
                </span>
              </Td>
              <Td>{domainNameById.get(c.domainId) ?? <span className="text-xs text-slate-400 font-mono">{c.domainId.slice(0, 8)}…</span>}</Td>
              <Td>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${VALIDATION_PILL[c.validationStatus]}`}>
                  {c.validationStatus}
                </span>
                {c.lastValidatedAt && (
                  <div className="text-xs text-slate-400 mt-0.5">
                    {new Date(c.lastValidatedAt).toLocaleDateString()}
                  </div>
                )}
              </Td>
              <Td>{new Date(c.createdAt).toLocaleDateString()}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RegisterConnectorForm({
  orgId,
  domains,
  onRegistered,
}: {
  orgId: string;
  domains: Domain[];
  onRegistered: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [domainId, setDomainId] = useState<string>(domains[0]?.id ?? '');
  const [connectorType, setConnectorType] = useState<ConnectorType>('postgresql');
  const [connectionConfig, setConnectionConfig] = useState<string>('{}');
  const [credentialArn, setCredentialArn] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);

    let parsedConfig: Record<string, unknown> = {};
    if (connectionConfig.trim()) {
      try {
        const raw: unknown = JSON.parse(connectionConfig);
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
          throw new Error('connection config must be a JSON object');
        }
        parsedConfig = raw as Record<string, unknown>;
      } catch (err) {
        setSubmitting(false);
        setResult({ ok: false, message: `Connection config: ${(err as Error).message}` });
        return;
      }
    }

    try {
      const trimmedDescription = description.trim();
      const trimmedArn = credentialArn.trim();
      await connectorsApi.register(orgId, {
        domainId,
        name: name.trim(),
        connectorType,
        connectionConfig: parsedConfig,
        ...(trimmedDescription ? { description: trimmedDescription } : {}),
        ...(trimmedArn ? { credentialArn: trimmedArn } : {}),
      });
      setResult({ ok: true, message: `Connector "${name.trim()}" registered. Run a validation check from the row when you're ready.` });
      setName('');
      setDescription('');
      setConnectionConfig('{}');
      setCredentialArn('');
      await onRegistered();
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message ?? 'Failed to register connector' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Register a connector</h2>
      <p className="mt-1 text-xs text-slate-500">
        Validation runs as a separate step after registration. Connection config is a JSON object whose required fields depend on the connector type — pass <code className="font-mono">{'{}'}</code> for now if you only want to record the reference.
      </p>
      <form onSubmit={(e) => { void handleSubmit(e); }} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Name">
          <input
            className="input w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. claims-warehouse"
            required
          />
        </Field>
        <Field label="Domain">
          <select
            className="input w-full"
            value={domainId}
            onChange={(e) => setDomainId(e.target.value)}
            required
          >
            {domains.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Connector type">
          <select
            className="input w-full"
            value={connectorType}
            onChange={(e) => setConnectorType(e.target.value as ConnectorType)}
          >
            {CONNECTOR_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Credential ARN (optional)" hint="AWS Secrets Manager ARN. Leave blank for connectors that don't need credentials.">
          <input
            className="input w-full"
            value={credentialArn}
            onChange={(e) => setCredentialArn(e.target.value)}
            placeholder="arn:aws:secretsmanager:…"
          />
        </Field>
        <Field label="Description (optional)">
          <input
            className="input w-full"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="One-line purpose, owner team, etc."
          />
        </Field>
        <Field label="Connection config (JSON)" hint="Non-sensitive parameters — host, port, database name, etc. Must parse as a JSON object.">
          <textarea
            className="input w-full font-mono text-xs h-20"
            value={connectionConfig}
            onChange={(e) => setConnectionConfig(e.target.value)}
            spellCheck={false}
          />
        </Field>
        <div className="md:col-span-2 flex items-center justify-between gap-3">
          {result && (
            <div
              className={`flex-1 rounded-md p-2 text-xs ${
                result.ok
                  ? 'bg-green-50 border border-green-200 text-green-700'
                  : 'bg-red-50 border border-red-200 text-red-700'
              }`}
            >
              {result.message}
            </div>
          )}
          <button
            type="submit"
            disabled={submitting || !name.trim() || !domainId}
            className="px-3 py-2 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {submitting ? 'Registering…' : 'Register connector'}
          </button>
        </div>
      </form>
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
