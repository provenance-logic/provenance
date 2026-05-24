/**
 * Tests for ConnectorDetailPage leaf components (B-075 Surface 1).
 *
 * Covers the three exported sub-components that carry the page's load-bearing
 * UI logic:
 *   - CrawlStatStrip   — renders crawl counters + lineage edges from metadata
 *   - DiscoverySummary — empty state when no crawl yet, stat strip + history accordion otherwise
 *   - DiscoveredSourcesTable — renders sources, empty state, loading state
 *
 * Pattern: leaf component tests per AgentDetailPage.test.tsx / SituationBanner.test.tsx.
 * Full-page mount is avoided because it requires mocking the router, Keycloak auth
 * provider, and the API client simultaneously — the sub-components are the
 * unit boundaries where correctness is testable in isolation.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DiscoveryCrawlEventRecord, SourceRegistration } from '@provenance/types';
import { CrawlStatStrip, DiscoverySummary, DiscoveredSourcesTable } from './ConnectorDetailPage.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseCrawlEvent = (overrides: Partial<DiscoveryCrawlEventRecord> = {}): DiscoveryCrawlEventRecord => ({
  id: '00000000-0000-0000-0000-000000000001',
  orgId: '00000000-0000-0000-0000-0000000000aa',
  connectorId: '00000000-0000-0000-0000-0000000000bb',
  triggeredBy: null,
  startedAt: '2026-05-20T10:00:00Z',
  completedAt: '2026-05-20T10:02:00Z',
  status: 'succeeded',
  catalogsWalked: 2,
  schemasWalked: 5,
  tablesFound: 10,
  sourcesCreated: 10,
  sourcesSkipped: 0,
  snapshotsCaptured: 10,
  snapshotsFailed: 0,
  errorMessage: null,
  metadata: { lineageEdgesEmitted: 9 },
  ...overrides,
});

const baseSource = (overrides: Partial<SourceRegistration> = {}): SourceRegistration => ({
  id: '00000000-0000-0000-0000-000000000010',
  orgId: '00000000-0000-0000-0000-0000000000aa',
  connectorId: '00000000-0000-0000-0000-0000000000bb',
  sourceRef: 'public.customers',
  sourceType: 'table',
  displayName: 'Customers',
  description: 'Customer master table',
  registeredBy: '00000000-0000-0000-0000-0000000000cc',
  registeredAt: '2026-05-20T10:02:00Z',
  updatedAt: '2026-05-20T10:02:00Z',
  ...overrides,
});

// ---------------------------------------------------------------------------
// CrawlStatStrip
// ---------------------------------------------------------------------------

describe('CrawlStatStrip', () => {
  it('renders tables found, sources created, and snapshots captured', () => {
    render(<CrawlStatStrip event={baseCrawlEvent()} />);

    expect(screen.getByText('Tables found')).toBeInTheDocument();
    expect(screen.getByText('Sources created')).toBeInTheDocument();
    expect(screen.getByText('Snapshots')).toBeInTheDocument();
    // Tables found + Sources created + Snapshots all show "10" — use getAllByText
    const tens = screen.getAllByText('10');
    expect(tens.length).toBeGreaterThanOrEqual(3);
  });

  it('renders lineage edges from metadata.lineageEdgesEmitted', () => {
    render(<CrawlStatStrip event={baseCrawlEvent({ metadata: { lineageEdgesEmitted: 9 } })} />);

    expect(screen.getByText('Lineage edges')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
  });

  it('omits lineage edges cell when metadata.lineageEdgesEmitted is absent', () => {
    render(<CrawlStatStrip event={baseCrawlEvent({ metadata: {} })} />);

    expect(screen.queryByText('Lineage edges')).not.toBeInTheDocument();
  });

  it('renders the snapshots-failed cell in red when snapshotsFailed > 0', () => {
    render(<CrawlStatStrip event={baseCrawlEvent({ snapshotsFailed: 3 })} />);

    expect(screen.getByText('Snapshots failed')).toBeInTheDocument();
    // The value "3" should appear with the danger class — test via text presence
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('omits snapshots-failed cell when snapshotsFailed is 0', () => {
    render(<CrawlStatStrip event={baseCrawlEvent({ snapshotsFailed: 0 })} />);

    expect(screen.queryByText('Snapshots failed')).not.toBeInTheDocument();
  });

  it('shows the succeeded status pill', () => {
    render(<CrawlStatStrip event={baseCrawlEvent({ status: 'succeeded' })} />);
    expect(screen.getByText('succeeded')).toBeInTheDocument();
  });

  it('shows the failed status pill', () => {
    render(<CrawlStatStrip event={baseCrawlEvent({ status: 'failed', errorMessage: 'timeout' })} />);
    expect(screen.getByText('failed')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// DiscoverySummary
// ---------------------------------------------------------------------------

describe('DiscoverySummary', () => {
  const noop = () => {};

  it('shows the empty state and a crawl button when latestCrawl is null', () => {
    render(
      <DiscoverySummary
        latestCrawl={null}
        priorCrawls={[]}
        onCrawl={noop}
        crawling={false}
      />,
    );

    expect(screen.getByText(/no discovery crawl has run yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run first crawl/i })).toBeInTheDocument();
  });

  it('shows the crawl button as disabled while crawling', () => {
    render(
      <DiscoverySummary
        latestCrawl={null}
        priorCrawls={[]}
        onCrawl={noop}
        crawling={true}
      />,
    );

    const btn = screen.getByRole('button', { name: /crawling/i });
    expect(btn).toBeDisabled();
  });

  it('renders the stat strip when a crawl event is provided', () => {
    render(
      <DiscoverySummary
        latestCrawl={baseCrawlEvent()}
        priorCrawls={[]}
        onCrawl={noop}
        crawling={false}
      />,
    );

    expect(screen.getByText('Tables found')).toBeInTheDocument();
    expect(screen.getByText('Lineage edges')).toBeInTheDocument();
    expect(screen.queryByText(/no discovery crawl/i)).not.toBeInTheDocument();
  });

  it('shows the error message when a crawl event has errorMessage', () => {
    render(
      <DiscoverySummary
        latestCrawl={baseCrawlEvent({ status: 'failed', errorMessage: 'connection refused' })}
        priorCrawls={[]}
        onCrawl={noop}
        crawling={false}
      />,
    );

    expect(screen.getByText(/crawl error/i)).toBeInTheDocument();
    expect(screen.getByText(/connection refused/i)).toBeInTheDocument();
  });

  it('shows the history toggle when there are prior crawls, and expands on click', () => {
    const prior = [
      baseCrawlEvent({ id: '00000000-0000-0000-0000-000000000002', tablesFound: 5 }),
    ];

    render(
      <DiscoverySummary
        latestCrawl={baseCrawlEvent()}
        priorCrawls={prior}
        onCrawl={noop}
        crawling={false}
      />,
    );

    // The toggle button shows "(1 prior run)" — singular because priorCrawls.length === 1
    const toggle = screen.getByRole('button', { name: /show crawl history/i });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveTextContent('1 prior run');

    // Click to expand — button text switches to "Hide crawl history …"
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: /hide crawl history/i })).toBeInTheDocument();
  });

  it('omits the history toggle when priorCrawls is empty', () => {
    render(
      <DiscoverySummary
        latestCrawl={baseCrawlEvent()}
        priorCrawls={[]}
        onCrawl={noop}
        crawling={false}
      />,
    );

    expect(screen.queryByRole('button', { name: /show crawl history/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /hide crawl history/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// DiscoveredSourcesTable
// ---------------------------------------------------------------------------

describe('DiscoveredSourcesTable', () => {
  const noop = vi.fn();

  it('shows a loading state when sources is null', () => {
    render(<DiscoveredSourcesTable sources={null} onCreateProduct={noop} />);

    expect(screen.getByText(/loading sources/i)).toBeInTheDocument();
  });

  it('shows the empty state when sources is an empty array', () => {
    render(<DiscoveredSourcesTable sources={[]} onCreateProduct={noop} />);

    expect(screen.getByText(/no sources registered yet/i)).toBeInTheDocument();
    expect(screen.getByText(/run a discovery crawl/i)).toBeInTheDocument();
  });

  it('renders source rows with ref, type, display name, and description', () => {
    render(
      <DiscoveredSourcesTable
        sources={[baseSource()]}
        onCreateProduct={noop}
      />,
    );

    expect(screen.getByText('public.customers')).toBeInTheDocument();
    expect(screen.getByText('table')).toBeInTheDocument();
    expect(screen.getByText('Customers')).toBeInTheDocument();
    expect(screen.getByText('Customer master table')).toBeInTheDocument();
  });

  it('shows "none" in italic for a source with no description', () => {
    render(
      <DiscoveredSourcesTable
        sources={[baseSource({ description: null })]}
        onCreateProduct={noop}
      />,
    );

    expect(screen.getByText('none')).toBeInTheDocument();
  });

  it('renders a "Create data product" button per source and calls onCreateProduct with the full source', () => {
    const handler = vi.fn();
    render(
      <DiscoveredSourcesTable
        sources={[baseSource()]}
        onCreateProduct={handler}
      />,
    );

    const btn = screen.getByRole('button', { name: /create data product/i });
    fireEvent.click(btn);
    // B-075 Tier A: the handler receives the whole source (it needs sourceRef +
    // displayName to build the deep-link router state), not just the id.
    expect(handler).toHaveBeenCalledWith(baseSource());
  });

  it('renders the correct source count in the subtitle', () => {
    render(
      <DiscoveredSourcesTable
        sources={[baseSource(), baseSource({ id: '00000000-0000-0000-0000-000000000011', sourceRef: 'public.orders' })]}
        onCreateProduct={noop}
      />,
    );

    expect(screen.getByText(/2 sources registered/i)).toBeInTheDocument();
  });

  it('renders a single source with singular "source" label', () => {
    render(
      <DiscoveredSourcesTable
        sources={[baseSource()]}
        onCreateProduct={noop}
      />,
    );

    expect(screen.getByText(/1 source registered/i)).toBeInTheDocument();
  });
});
