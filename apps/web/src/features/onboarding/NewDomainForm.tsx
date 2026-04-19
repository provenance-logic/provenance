import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { organizationsApi } from '../../shared/api/organizations.js';
import { useAuth } from '../../auth/AuthProvider.js';

export function NewDomainForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { principalId } = useAuth();
  const orgId = searchParams.get('orgId') ?? '';

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function slugFrom(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 63);
  }

  function handleNameChange(value: string) {
    setName(value);
    if (!slug || slug === slugFrom(name)) {
      setSlug(slugFrom(value));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId || !principalId) {
      setError('Missing organization or principal context — please reload.');
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const trimmedDesc = description.trim();
      const domain = await organizationsApi.domains.create(orgId, {
        name: name.trim(),
        slug: slug.trim(),
        ownerPrincipalId: principalId,
        ...(trimmedDesc ? { description: trimmedDesc } : {}),
      });
      navigate(`/dashboard/${orgId}/domains/${domain.id}`);
    } catch (err) {
      setError((err as Error).message ?? 'Failed to create domain');
      setSubmitting(false);
    }
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Create a domain</h1>
        <p className="mt-1 text-sm text-slate-500">
          Domains organize related data products under a single owner. You'll be the initial owner.
        </p>
      </div>

      <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-5">
        <Field label="Domain name" required>
          <input
            type="text"
            className="input"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Customer Analytics"
            maxLength={120}
            required
          />
        </Field>

        <Field label="Slug" required hint="URL-safe identifier — lowercase letters, numbers, and hyphens.">
          <input
            type="text"
            className="input"
            value={slug}
            onChange={(e) => setSlug(slugFrom(e.target.value))}
            placeholder="customer-analytics"
            maxLength={63}
            pattern="^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$"
            required
          />
        </Field>

        <Field label="Description">
          <textarea
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="What kinds of data products live in this domain?"
          />
        </Field>

        {error && (
          <div className="rounded-md bg-red-50 p-3 border border-red-200 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting || !name.trim() || !slug.trim() || !orgId || !principalId}
            className="px-4 py-2 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Creating…' : 'Create domain'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            disabled={submitting}
            className="px-4 py-2 rounded-md border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
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
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
