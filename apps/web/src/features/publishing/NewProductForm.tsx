import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { productsApi } from '../../shared/api/products.js';
import type { DataClassification } from '@meshos/types';
import { useAuth } from '../../auth/AuthProvider.js';

const classifications: DataClassification[] = ['public', 'internal', 'confidential', 'restricted'];

export function NewProductForm() {
  const { orgId, domainId } = useParams<{ orgId: string; domainId: string }>();
  const navigate = useNavigate();
  const { keycloak } = useAuth();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [classification, setClassification] = useState<DataClassification>('internal');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slug || slug === toSlug(name)) {
      setSlug(toSlug(value));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !domainId) return;
    setSubmitting(true);
    setError(null);
    try {
      const principalId = (keycloak.tokenParsed as { meshos_principal_id?: string } | undefined)
        ?.meshos_principal_id ?? keycloak.subject ?? '';
      const product = await productsApi.create(orgId, domainId, {
        name,
        slug,
        description: description || undefined,
        classification,
        ownerPrincipalId: principalId,
      });
      navigate(`/dashboard/${orgId}/domains/${domainId}/products/${product.id}`);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold text-slate-900 mb-6">New Data Product</h1>

      <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-5">
        <Field label="Name" required>
          <input
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            className="input"
            required
            placeholder="Customer 360 Profile"
          />
        </Field>

        <Field label="Slug" required hint="URL-safe identifier. Auto-generated from name.">
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="input font-mono text-sm"
            required
            pattern="^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$"
            placeholder="customer-360-profile"
          />
        </Field>

        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input min-h-[80px] resize-y"
            placeholder="What does this data product contain and who is it for?"
          />
        </Field>

        <Field label="Data Classification" required>
          <select
            value={classification}
            onChange={(e) => setClassification(e.target.value as DataClassification)}
            className="input"
          >
            {classifications.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>

        {error && (
          <div className="rounded-md bg-red-50 p-3 border border-red-200 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Creating…' : 'Create Data Product'}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="px-4 py-2 rounded-md border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  children,
  required,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}
