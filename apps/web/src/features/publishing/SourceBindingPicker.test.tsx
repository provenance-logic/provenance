/**
 * Tests for the SourceBindingPicker — F2.8a producer UI (B-070 close).
 *
 * Pins the load-bearing behavior:
 *   - lists the org's connectors on mount,
 *   - loads the chosen connector's source registrations on pick,
 *   - on source pick, calls onSourceChange with the source's sourceRef
 *     as the default path (the producer can then edit it),
 *   - graceful empty / error states.
 *
 * Pattern: leaf component imported directly per the same approach as
 * AgentDetailPage.test.tsx (see #159 setup).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Connector, SourceRegistration } from '@provenance/types';

// Mock the API client before importing the component so the component
// picks up the mocked functions at module-evaluation time.
vi.mock('../../shared/api/connectors.js', () => ({
  connectorsApi: {
    list: vi.fn(),
    listSources: vi.fn(),
  },
}));

import { connectorsApi } from '../../shared/api/connectors.js';
import { SourceBindingPicker } from './ProductDetail.js';

const ORG_ID = '00000000-0000-0000-0000-0000000000aa';

const makeConnector = (overrides: Partial<Connector> = {}): Connector => ({
  id: '00000000-0000-0000-0000-000000000001',
  orgId: ORG_ID,
  domainId: '00000000-0000-0000-0000-0000000000bb',
  name: 'Production PG',
  description: null,
  connectorType: 'postgresql',
  connectionConfig: {},
  credentialArn: null,
  validationStatus: 'valid',
  lastValidatedAt: null,
  createdBy: '00000000-0000-0000-0000-0000000000cc',
  createdAt: '2026-05-20T10:00:00Z',
  updatedAt: '2026-05-20T10:00:00Z',
  ...overrides,
});

const makeSource = (overrides: Partial<SourceRegistration> = {}): SourceRegistration => ({
  id: '00000000-0000-0000-0000-000000000010',
  orgId: ORG_ID,
  connectorId: '00000000-0000-0000-0000-000000000001',
  sourceRef: 'public.customers',
  sourceType: 'table',
  displayName: 'Customers Table',
  description: null,
  registeredBy: '00000000-0000-0000-0000-0000000000cc',
  registeredAt: '2026-05-20T10:00:00Z',
  updatedAt: '2026-05-20T10:00:00Z',
  ...overrides,
});

const noop = () => {};

describe('SourceBindingPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the collapsible "optional" summary and loads connectors on mount', async () => {
    (connectorsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [makeConnector()],
      meta: { total: 1, limit: 100, offset: 0 },
    });

    render(
      <SourceBindingPicker
        orgId={ORG_ID}
        selectedConnectorId=""
        sourceRegistrationId=""
        sourceObjectPath=""
        onConnectorChange={noop}
        onSourceChange={noop}
        onPathChange={noop}
      />,
    );

    expect(
      screen.getByText(/bind to a discovered source/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/\(optional\)/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(connectorsApi.list).toHaveBeenCalledWith(ORG_ID, 100, 0);
    });
    await waitFor(() => {
      expect(screen.getByText(/Production PG \(postgresql\)/i)).toBeInTheDocument();
    });
  });

  it('loads sources after a connector is selected and pre-fills the path on source pick', async () => {
    (connectorsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [makeConnector()],
      meta: { total: 1, limit: 100, offset: 0 },
    });
    (connectorsApi.listSources as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [makeSource({ sourceRef: 'prod.customer.events' })],
      meta: { total: 1, limit: 100, offset: 0 },
    });

    const onSourceChange = vi.fn();
    const connectorId = '00000000-0000-0000-0000-000000000001';

    // Simulates the parent's state machine: connector already picked,
    // so the source dropdown should be visible and loaded.
    render(
      <SourceBindingPicker
        orgId={ORG_ID}
        selectedConnectorId={connectorId}
        sourceRegistrationId=""
        sourceObjectPath=""
        onConnectorChange={noop}
        onSourceChange={onSourceChange}
        onPathChange={noop}
      />,
    );

    await waitFor(() => {
      expect(connectorsApi.listSources).toHaveBeenCalledWith(ORG_ID, connectorId, 100, 0);
    });
    const sourceOption = await screen.findByRole('option', {
      name: /Customers Table — prod\.customer\.events/i,
    });
    const sourceSelect = sourceOption.closest('select');
    expect(sourceSelect).not.toBeNull();
    await userEvent.selectOptions(sourceSelect!, '00000000-0000-0000-0000-000000000010');

    expect(onSourceChange).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000010',
      'prod.customer.events',
    );
  });

  it('shows "no sources registered" when the connector has none', async () => {
    (connectorsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [makeConnector()],
      meta: { total: 1, limit: 100, offset: 0 },
    });
    (connectorsApi.listSources as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [],
      meta: { total: 0, limit: 100, offset: 0 },
    });

    render(
      <SourceBindingPicker
        orgId={ORG_ID}
        selectedConnectorId="00000000-0000-0000-0000-000000000001"
        sourceRegistrationId=""
        sourceObjectPath=""
        onConnectorChange={noop}
        onSourceChange={noop}
        onPathChange={noop}
      />,
    );

    expect(
      await screen.findByText(/no sources registered for this connector/i),
    ).toBeInTheDocument();
  });

  it('shows an error message when the connectors fetch fails', async () => {
    (connectorsApi.list as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('boom'),
    );

    render(
      <SourceBindingPicker
        orgId={ORG_ID}
        selectedConnectorId=""
        sourceRegistrationId=""
        sourceObjectPath=""
        onConnectorChange={noop}
        onSourceChange={noop}
        onPathChange={noop}
      />,
    );

    expect(await screen.findByText(/could not load connectors: boom/i)).toBeInTheDocument();
  });

  it('is collapsed by default but expanded when defaultOpen is set (B-075 Tier A)', async () => {
    (connectorsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [makeConnector()],
      meta: { total: 1, limit: 100, offset: 0 },
    });

    const baseProps = {
      orgId: ORG_ID,
      selectedConnectorId: '',
      sourceRegistrationId: '',
      sourceObjectPath: '',
      onConnectorChange: noop,
      onSourceChange: noop,
      onPathChange: noop,
    };

    const { rerender } = render(<SourceBindingPicker {...baseProps} />);
    // jsdom keeps <details> children mounted regardless of open state, so the
    // `open` attribute — not child visibility — is the signal under test.
    const details = screen.getByText(/bind to a discovered source/i).closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');

    rerender(<SourceBindingPicker {...baseProps} defaultOpen />);
    expect(screen.getByText(/bind to a discovered source/i).closest('details')).toHaveAttribute('open');

    // Let the mount fetch settle so its state update doesn't leak past the test.
    await waitFor(() => {
      expect(connectorsApi.list).toHaveBeenCalledWith(ORG_ID, 100, 0);
    });
  });

  it('shows the path field only once a source is selected, and forwards edits', async () => {
    (connectorsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [makeConnector()],
      meta: { total: 1, limit: 100, offset: 0 },
    });
    (connectorsApi.listSources as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [makeSource()],
      meta: { total: 1, limit: 100, offset: 0 },
    });
    const onPathChange = vi.fn();

    render(
      <SourceBindingPicker
        orgId={ORG_ID}
        selectedConnectorId="00000000-0000-0000-0000-000000000001"
        sourceRegistrationId="00000000-0000-0000-0000-000000000010"
        sourceObjectPath="public.customers"
        onConnectorChange={noop}
        onSourceChange={noop}
        onPathChange={onPathChange}
      />,
    );

    const pathInput = await screen.findByPlaceholderText(/public\.users.*prod\.customer\.events/i);
    expect(pathInput).toHaveValue('public.customers');

    await userEvent.clear(pathInput);
    await userEvent.type(pathInput, 'public.customer_view');
    // userEvent fires per-keystroke onChange, so the final call carries
    // the final character. Asserting it was called and that the last
    // call has the right tail is the cleanest signal.
    expect(onPathChange).toHaveBeenCalled();
    const lastCall = onPathChange.mock.calls[onPathChange.mock.calls.length - 1][0] as string;
    expect(lastCall).toContain('w'); // last char of "view"
  });
});
