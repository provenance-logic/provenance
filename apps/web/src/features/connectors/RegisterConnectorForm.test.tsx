/**
 * Tests for the spec-driven connector registration form (ADR-012, slice 1).
 *
 * Pins the new UX behavior:
 *   - renders typed fields per connector type from the spec,
 *   - switching type swaps the fields (and seeds defaults),
 *   - the Snowflake paste-a-URL smart-fill populates the host field,
 *   - submit builds connection_config from the typed fields (not raw JSON).
 *
 * Pattern mirrors SourceBindingPicker.test.tsx: mock the API client, import the
 * leaf component directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Domain } from '@provenance/types';

vi.mock('../../shared/api/connectors.js', () => ({
  connectorsApi: { register: vi.fn() },
}));
vi.mock('../../shared/api/organizations.js', () => ({
  organizationsApi: {},
}));

import { connectorsApi } from '../../shared/api/connectors.js';
import { RegisterConnectorForm } from './ConnectorsPage.js';

const ORG_ID = '00000000-0000-0000-0000-0000000000aa';
const domains = [{ id: 'dom-1', name: 'Marketing' }] as unknown as Domain[];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RegisterConnectorForm', () => {
  it('renders PostgreSQL typed fields by default (not a raw JSON box)', () => {
    render(<RegisterConnectorForm orgId={ORG_ID} domains={domains} onRegistered={vi.fn()} />);
    expect(screen.getByPlaceholderText('db.example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('5432')).toBeInTheDocument(); // port default
    // The old raw connection-config textarea is gone.
    expect(screen.queryByText('Connection config (JSON)')).not.toBeInTheDocument();
  });

  it('swaps to Snowflake fields and smart-fills the host from a pasted URL', async () => {
    const user = userEvent.setup();
    render(<RegisterConnectorForm orgId={ORG_ID} domains={domains} onRegistered={vi.fn()} />);

    const typeSelect = screen.getByDisplayValue('PostgreSQL');
    await user.selectOptions(typeSelect, 'snowflake');

    // Snowflake spec fields + defaults appear.
    expect(screen.getByDisplayValue('COMPUTE_WH')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ACCOUNTADMIN')).toBeInTheDocument();

    const paste = screen.getByPlaceholderText(/^https:\/\//i);
    await user.type(paste, 'https://xy12345.us-east-1.snowflakecomputing.com');

    // Host field is populated by the parser.
    await waitFor(() =>
      expect(
        screen.getByDisplayValue('xy12345.us-east-1.snowflakecomputing.com'),
      ).toBeInTheDocument(),
    );
    // Account identifier surfaced for the credential.
    expect(screen.getByText(/account identifier is xy12345/i)).toBeInTheDocument();
  });

  it('submits a connection_config built from typed fields', async () => {
    const user = userEvent.setup();
    (connectorsApi.register as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const onRegistered = vi.fn().mockResolvedValue(undefined);
    render(<RegisterConnectorForm orgId={ORG_ID} domains={domains} onRegistered={onRegistered} />);

    await user.type(screen.getByPlaceholderText('e.g. claims-warehouse'), 'claims-pg');
    await user.type(screen.getByPlaceholderText('db.example.com'), 'db.internal');
    await user.type(screen.getByPlaceholderText('analytics'), 'claims');

    await user.click(screen.getByRole('button', { name: /register connector/i }));

    await waitFor(() => expect(connectorsApi.register).toHaveBeenCalledTimes(1));
    const [orgArg, payload] = (connectorsApi.register as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(orgArg).toBe(ORG_ID);
    expect(payload.connectorType).toBe('postgresql');
    expect(payload.connectionConfig).toEqual({
      host: 'db.internal',
      port: 5432,
      database: 'claims',
      ssl: true,
    });
  });
});
