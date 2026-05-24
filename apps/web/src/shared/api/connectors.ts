import { api } from './client.js';
import type {
  Connector,
  ConnectorList,
  DiscoveryCrawlEventRecord,
  RegisterConnectorRequest,
  SourceRegistrationList,
  UpdateConnectorRequest,
} from '@provenance/types';

export const connectorsApi = {
  list: (orgId: string, limit = 50, offset = 0) =>
    api.get<ConnectorList>(
      `/organizations/${encodeURIComponent(orgId)}/connectors?limit=${limit}&offset=${offset}`,
    ),
  register: (orgId: string, dto: RegisterConnectorRequest) =>
    api.post<Connector>(
      `/organizations/${encodeURIComponent(orgId)}/connectors`,
      dto,
    ),
  get: (orgId: string, connectorId: string) =>
    api.get<Connector>(
      `/organizations/${encodeURIComponent(orgId)}/connectors/${encodeURIComponent(connectorId)}`,
    ),
  update: (orgId: string, connectorId: string, dto: UpdateConnectorRequest) =>
    api.patch<Connector>(
      `/organizations/${encodeURIComponent(orgId)}/connectors/${encodeURIComponent(connectorId)}`,
      dto,
    ),
  remove: (orgId: string, connectorId: string) =>
    api.delete(
      `/organizations/${encodeURIComponent(orgId)}/connectors/${encodeURIComponent(connectorId)}`,
    ),
  validate: (orgId: string, connectorId: string) =>
    api.post<{ status: string }>(
      `/organizations/${encodeURIComponent(orgId)}/connectors/${encodeURIComponent(connectorId)}/validate`,
      {},
    ),
  /**
   * Lists registered source objects for a connector (F2.8a producer UI —
   * the "Pick from discovered objects" picker in the port form).
   */
  listSources: (orgId: string, connectorId: string, limit = 100, offset = 0) =>
    api.get<SourceRegistrationList>(
      `/organizations/${encodeURIComponent(orgId)}/connectors/${encodeURIComponent(connectorId)}/sources?limit=${limit}&offset=${offset}`,
    ),

  /**
   * Triggers a discovery crawl for the given connector. Returns the newly
   * created crawl-event record (the crawl runs synchronously in the API
   * request — future Temporal integration will make this async).
   */
  crawl: (orgId: string, connectorId: string) =>
    api.post<DiscoveryCrawlEventRecord>(
      `/organizations/${encodeURIComponent(orgId)}/connectors/${encodeURIComponent(connectorId)}/crawl`,
      {},
    ),

  /**
   * Returns the crawl history for a connector, newest first.
   * The endpoint returns DiscoveryCrawlEventRecord[] (not a PaginatedList).
   */
  listCrawlEvents: (orgId: string, connectorId: string, limit = 10) =>
    api.get<DiscoveryCrawlEventRecord[]>(
      `/organizations/${encodeURIComponent(orgId)}/connectors/${encodeURIComponent(connectorId)}/crawl-events?limit=${limit}`,
    ),
};
