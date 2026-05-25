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
import {
  CONNECTOR_SPECS,
  defaultConfigValues,
  buildConnectionConfig,
  buildCredentialSecret,
} from './connector-specs.js';
import { parseSnowflakeUrl } from './snowflake-url.js';

// F7.46 follow-on (B-025) — Connectors page.
//
// Lists every connector registered for the active org and exposes a
// registration form bound to POST /organizations/:orgId/connectors. The
// form renders typed, labeled fields per connector type from a declarative
// spec (`connector-specs.ts`; ADR-012 decision 1 + ADR-013 credential vault).
//
// Credential entry: secret fields render as masked password inputs. The form
// assembles `credentialSecret` (a JSON object) and submits it to the API,
// which encrypts it at rest and returns a `vault:<uuid>` reference. An
// "Advanced" toggle lets operators supply a pre-staged ARN/local-env ref in
// `credentialArn` directly instead (the old path, preserved for ops/migration).
//
// Per PRD F3.2 + F3.2a: only connector types working end-to-end are exposed.
const CONNECTOR_TYPES: { value: ConnectorType; label: string }[] = [
  { value: 'postgresql',  label: 'PostgreSQL' },
  { value: 'databricks',  label: 'Databricks' },
  { value: 's3',          label: 'S3' },
  { value: 'snowflake',   label: 'Snowflake' },
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
          Connectors register your existing data systems against a domain inside <span className="font-medium text-slate-700">{org.name}</span> so lineage and access can flow through Provenance. Credentials are encrypted at rest — raw secrets are never persisted or returned.
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
                <Link
                  to={`/connectors/${c.id}`}
                  className="font-medium text-slate-900 hover:text-brand-700"
                >
                  {c.name}
                </Link>
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

export function RegisterConnectorForm({
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
  const [configValues, setConfigValues] = useState<Record<string, string>>(
    () => defaultConfigValues('postgresql'),
  );
  // Secret field values — assembled into credentialSecret on submit.
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  // Advanced: allow operator to type a pre-staged ARN or local-env sentinel.
  const [showAdvancedArn, setShowAdvancedArn] = useState(false);
  const [credentialArn, setCredentialArn] = useState('');
  const [smartFill, setSmartFill] = useState('');
  const [smartFillNote, setSmartFillNote] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const spec = CONNECTOR_SPECS[connectorType];

  function changeType(next: ConnectorType) {
    setConnectorType(next);
    setConfigValues(defaultConfigValues(next));
    setSecretValues({});
    setCredentialArn('');
    setSmartFill('');
    setSmartFillNote(null);
    setShowAdvancedArn(false);
  }

  function setField(key: string, value: string) {
    setConfigValues((prev) => ({ ...prev, [key]: value }));
  }

  function setSecretField(key: string, value: string) {
    setSecretValues((prev) => ({ ...prev, [key]: value }));
  }

  function applySmartFill(value: string) {
    setSmartFill(value);
    const parsed = parseSnowflakeUrl(value);
    if (parsed) {
      setField('host', parsed.host);
      setSmartFillNote(
        parsed.account
          ? `Filled the host below. Your account identifier is ${parsed.account}${parsed.region ? ` (region ${parsed.region})` : ''} — use it in the credential's "account" field.`
          : 'Filled the host below.',
      );
    } else {
      setSmartFillNote(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);

    const missing = spec.fields
      .filter((f) => f.required && !(configValues[f.key] ?? '').trim())
      .map((f) => f.label);
    if (missing.length > 0) {
      setSubmitting(false);
      setResult({ ok: false, message: `Please fill required field(s): ${missing.join(', ')}` });
      return;
    }

    try {
      const trimmedDescription = description.trim();
      const trimmedArn = credentialArn.trim();

      // Prefer credentialSecret (self-service vault) unless the user explicitly
      // entered a pre-staged ARN in the advanced toggle.
      const credentialSecret = buildCredentialSecret(connectorType, secretValues);

      // Validate: if credential is required and neither secret fields nor ARN provided, block.
      if (spec.credential.required && !credentialSecret && !trimmedArn) {
        setSubmitting(false);
        setResult({ ok: false, message: `${spec.credential.label} is required.` });
        return;
      }

      await connectorsApi.register(orgId, {
        domainId,
        name: name.trim(),
        connectorType,
        connectionConfig: buildConnectionConfig(connectorType, configValues),
        ...(trimmedDescription ? { description: trimmedDescription } : {}),
        // credentialSecret takes precedence; if the user entered an ARN
        // in the advanced field instead, send that as credentialArn.
        ...(credentialSecret ? { credentialSecret } : {}),
        ...(!credentialSecret && trimmedArn ? { credentialArn: trimmedArn } : {}),
      });
      setResult({ ok: true, message: `Connector "${name.trim()}" registered. Run a validation check from the row when you're ready.` });
      setName('');
      setDescription('');
      changeType(connectorType);
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
      <p className="mt-1 text-xs text-slate-500">{spec.blurb} Validation runs as a separate step after registration.</p>
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
            onChange={(e) => changeType(e.target.value as ConnectorType)}
          >
            {CONNECTOR_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Description (optional)">
          <input
            className="input w-full"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="One-line purpose, owner team, etc."
          />
        </Field>

        {spec.smartFill && (
          <div className="md:col-span-2">
            <Field label={spec.smartFill.label} hint={smartFillNote ?? spec.smartFill.help}>
              <input
                className="input w-full"
                value={smartFill}
                onChange={(e) => applySmartFill(e.target.value)}
                placeholder={spec.smartFill.placeholder}
                spellCheck={false}
              />
            </Field>
          </div>
        )}

        {spec.fields.map((f) => (
          <Field key={f.key} label={f.label} hint={f.help}>
            {f.type === 'boolean' ? (
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={(configValues[f.key] ?? 'false') === 'true'}
                onChange={(e) => setField(f.key, e.target.checked ? 'true' : 'false')}
              />
            ) : (
              <input
                className="input w-full"
                type={f.type === 'number' ? 'number' : 'text'}
                value={configValues[f.key] ?? ''}
                onChange={(e) => setField(f.key, e.target.value)}
                placeholder={f.placeholder}
                required={f.required}
                spellCheck={false}
              />
            )}
          </Field>
        ))}

        {/* Self-service secret entry (ADR-013) */}
        {spec.credential.secretFields.length > 0 && !showAdvancedArn && (
          <div className="md:col-span-2">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-700">{spec.credential.label}</span>
                <button
                  type="button"
                  onClick={() => setShowAdvancedArn(true)}
                  className="text-xs text-slate-500 hover:text-slate-700 underline"
                >
                  Advanced: use a pre-staged ARN
                </button>
              </div>
              <p className="text-xs text-slate-500 mb-3">{spec.credential.help} Your secret is encrypted at rest — it is never logged or returned.</p>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {spec.credential.secretFields.map((sf) => (
                  <Field key={sf.key} label={sf.label} hint={sf.help}>
                    <input
                      className="input w-full font-mono text-xs"
                      type="password"
                      value={secretValues[sf.key] ?? ''}
                      onChange={(e) => setSecretField(sf.key, e.target.value)}
                      placeholder={sf.placeholder}
                      required={spec.credential.required && sf.required}
                      autoComplete="new-password"
                      spellCheck={false}
                    />
                  </Field>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Advanced: pre-staged ARN / local-env sentinel */}
        {(showAdvancedArn || spec.credential.secretFields.length === 0) && (
          <div className="md:col-span-2">
            <Field
              label={spec.credential.secretFields.length > 0 ? 'Credential reference (ARN / local-env)' : spec.credential.label}
              hint={spec.credential.secretFields.length > 0
                ? 'Pre-staged AWS Secrets Manager ARN or local-env:VAR sentinel.'
                : spec.credential.help}
            >
              <div className="flex items-center gap-2">
                <input
                  className="input w-full font-mono text-xs"
                  value={credentialArn}
                  onChange={(e) => setCredentialArn(e.target.value)}
                  placeholder="arn:aws:secretsmanager:… or local-env:MY_VAR"
                  required={spec.credential.required && spec.credential.secretFields.length === 0}
                  spellCheck={false}
                />
                {spec.credential.secretFields.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { setShowAdvancedArn(false); setCredentialArn(''); }}
                    className="text-xs text-slate-500 hover:text-slate-700 whitespace-nowrap underline"
                  >
                    Use secret fields
                  </button>
                )}
              </div>
            </Field>
          </div>
        )}

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
  hint?: string | undefined;
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
