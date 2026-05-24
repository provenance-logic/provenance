/**
 * Tests for the UserMenu — F7.48 sidebar-bottom avatar dropdown.
 *
 * Pins the four behaviors that matter:
 *   - Initials derivation (display name, single word, email fallback)
 *   - Dropdown open / close on click + Escape
 *   - "Account" link routes to /account
 *   - "Sign out" calls keycloak.logout()
 *
 * meApi.getProfile is mocked so the test runs without the API. The
 * useAuth() hook is mocked to inject a stub keycloak so we can assert
 * the logout call without touching the real Keycloak SDK.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { UserMenu } from './UserMenu.js';

const mockLogout = vi.fn();
const mockGetProfile = vi.fn();

vi.mock('../../auth/AuthProvider.js', () => ({
  useAuth: () => ({ keycloak: { logout: mockLogout } }),
}));

vi.mock('../api/me.js', () => ({
  meApi: { getProfile: (): Promise<unknown> => mockGetProfile() as Promise<unknown> },
}));

const baseProfile = {
  principalId: '00000000-0000-0000-0000-000000000001',
  keycloakSubject: 'kc-sub',
  principalType: 'human_user' as const,
  displayName: 'Maya Lopez',
  email: 'maya@acme.example.com',
  org: { id: '00000000-0000-0000-0000-000000000002', name: 'Acme Corp', slug: 'acme-corp' },
  roles: ['domain_owner' as const],
};

function renderMenu(): void {
  render(
    <MemoryRouter>
      <UserMenu />
    </MemoryRouter>,
  );
}

describe('UserMenu', () => {
  beforeEach(() => {
    mockLogout.mockReset();
    mockGetProfile.mockReset();
  });

  it('renders initials from first + last name of the displayName', async () => {
    mockGetProfile.mockResolvedValue(baseProfile);
    renderMenu();
    expect(await screen.findByText('ML')).toBeInTheDocument();
    expect(screen.getByText('Maya Lopez')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
  });

  it('falls back to first two chars of email when displayName is missing', async () => {
    mockGetProfile.mockResolvedValue({ ...baseProfile, displayName: null });
    renderMenu();
    expect(await screen.findByText('MA')).toBeInTheDocument();
    expect(screen.getByText('maya@acme.example.com')).toBeInTheDocument();
  });

  it('opens the dropdown on click and shows Account + Sign out', async () => {
    mockGetProfile.mockResolvedValue(baseProfile);
    renderMenu();
    await screen.findByText('Maya Lopez');

    expect(screen.queryByRole('menuitem', { name: 'Account' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /maya lopez/i }));

    expect(screen.getByRole('menuitem', { name: 'Account' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('Sign out invokes keycloak.logout()', async () => {
    mockGetProfile.mockResolvedValue(baseProfile);
    renderMenu();
    await screen.findByText('Maya Lopez');

    fireEvent.click(screen.getByRole('button', { name: /maya lopez/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
  });

  it('Account dropdown entry points at /account', async () => {
    mockGetProfile.mockResolvedValue(baseProfile);
    renderMenu();
    await screen.findByText('Maya Lopez');

    fireEvent.click(screen.getByRole('button', { name: /maya lopez/i }));

    const accountLink = screen.getByRole('menuitem', { name: 'Account' });
    expect(accountLink).toHaveAttribute('href', '/account');
  });

  it('closes the dropdown when Escape is pressed', async () => {
    mockGetProfile.mockResolvedValue(baseProfile);
    renderMenu();
    await screen.findByText('Maya Lopez');

    fireEvent.click(screen.getByRole('button', { name: /maya lopez/i }));
    expect(screen.getByRole('menuitem', { name: 'Account' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: 'Account' })).not.toBeInTheDocument();
    });
  });

  it('still renders with fallback initials when the profile fetch fails', async () => {
    mockGetProfile.mockRejectedValue(new Error('500'));
    renderMenu();
    // Wait a tick for the async failure
    await waitFor(() => expect(screen.getByText('··')).toBeInTheDocument());
    expect(screen.getByText('Account')).toBeInTheDocument(); // fallback name label
  });
});
