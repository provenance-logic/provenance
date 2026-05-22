/**
 * Tests for the ReferencesTab component on the agent detail page.
 *
 * Covers B-066 — legacy connection references must render visually distinct
 * from properly-requested references (the audit caught CLAUDE.md asserting
 * this rule while the UI rendered both identically; PR #153 added the
 * branching; these tests pin the rendering so a future regression fails CI).
 *
 * Pattern reference for new frontend tests: prefer pure component tests like
 * these over full-page renders that require mocking the router, auth provider,
 * and API client. Export the leaf component if needed to keep tests focused.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ConnectionReference } from '@provenance/types';
import { ReferencesTab } from './AgentDetailPage.js';

const baseRef = (overrides: Partial<ConnectionReference> = {}): ConnectionReference => ({
  id: '00000000-0000-0000-0000-000000000001',
  orgId: '00000000-0000-0000-0000-0000000000aa',
  agentId: '00000000-0000-0000-0000-0000000000bb',
  productId: '00000000-0000-0000-0000-0000000000cc',
  productVersionId: null,
  accessGrantId: '00000000-0000-0000-0000-0000000000dd',
  owningPrincipalId: '00000000-0000-0000-0000-0000000000ee',
  state: 'active',
  causedBy: 'principal_action',
  requestedAt: '2026-05-20T10:00:00Z',
  approvedAt: '2026-05-20T10:30:00Z',
  activatedAt: '2026-05-20T10:30:00Z',
  suspendedAt: null,
  expiresAt: '2026-06-20T10:30:00Z',
  terminatedAt: null,
  approvedByPrincipalId: '00000000-0000-0000-0000-0000000000ff',
  governancePolicyVersion: null,
  useCaseCategory: 'reporting_and_analytics',
  purposeElaboration: 'Quarterly revenue dashboard automation',
  intendedScope: { ports: ['port-1'] },
  dataCategoryConstraints: null,
  requestedDurationDays: 30,
  approvedScope: { ports: ['port-1'] },
  approvedDataCategoryConstraints: null,
  approvedDurationDays: 30,
  modifiedByApprover: false,
  denialReason: null,
  deniedByPrincipalId: null,
  connectionPackage: null,
  createdAt: '2026-05-20T10:00:00Z',
  updatedAt: '2026-05-20T10:30:00Z',
  ...overrides,
});

function renderTab(refs: ConnectionReference[] | null) {
  // ReferencesTab renders <Link> from react-router; needs a Router context.
  return render(
    <MemoryRouter>
      <ReferencesTab references={refs} />
    </MemoryRouter>,
  );
}

describe('ReferencesTab', () => {
  it('shows a loading state when references are null', () => {
    renderTab(null);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows the empty state when references is an empty array', () => {
    renderTab([]);
    expect(screen.getByText(/no connection references/i)).toBeInTheDocument();
    expect(screen.getByText(/Domain 12 requires an active connection reference/i)).toBeInTheDocument();
  });

  it('renders a normal (non-legacy) reference without the legacy badge or warning copy', () => {
    renderTab([baseRef()]);

    // State badge present.
    expect(screen.getByText('active')).toBeInTheDocument();

    // Use-case copy present.
    expect(screen.getByText(/reporting_and_analytics/)).toBeInTheDocument();
    expect(screen.getByText(/Quarterly revenue dashboard automation/)).toBeInTheDocument();

    // Legacy distinctions MUST NOT appear for a normal ref.
    expect(screen.queryByText(/legacy.*non-renewable/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/legacy compatibility reference/i)).not.toBeInTheDocument();
  });

  it('renders a legacy reference with the legacy badge AND the explanatory paragraph (B-066)', () => {
    renderTab([baseRef({ causedBy: 'legacy_migration' })]);

    // Legacy pill badge is present.
    expect(screen.getByText(/legacy.*non-renewable/i)).toBeInTheDocument();

    // Explanatory paragraph that tells operators what to do before expiry.
    expect(
      screen.getByText(/legacy compatibility reference created at Domain 12 enforcement activation/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/cannot be renewed.*submit a proper connection-reference request/i),
    ).toBeInTheDocument();

    // The state badge still renders alongside the legacy badge.
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('only marks the row legacy when causedBy is exactly "legacy_migration"', () => {
    // A grant_revocation_cascade ref is NOT legacy — the visual distinction
    // is reserved for the F12.25 auto-provisioned 30-day stubs only.
    renderTab([baseRef({ causedBy: 'grant_revocation_cascade' })]);

    expect(screen.queryByText(/legacy.*non-renewable/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/legacy compatibility reference/i)).not.toBeInTheDocument();
  });

  it('renders multiple references — one legacy, one normal — with distinct treatments', () => {
    renderTab([
      baseRef({ id: '00000000-0000-0000-0000-000000000001', causedBy: 'legacy_migration' }),
      baseRef({ id: '00000000-0000-0000-0000-000000000002', causedBy: 'principal_action' }),
    ]);

    // Exactly one legacy badge (for the legacy ref).
    const legacyBadges = screen.getAllByText(/legacy.*non-renewable/i);
    expect(legacyBadges).toHaveLength(1);

    // Exactly one explanatory paragraph (for the legacy ref).
    const explanations = screen.getAllByText(/legacy compatibility reference created at Domain 12/i);
    expect(explanations).toHaveLength(1);

    // Both refs show the state badge.
    const stateBadges = screen.getAllByText('active');
    expect(stateBadges).toHaveLength(2);
  });
});
