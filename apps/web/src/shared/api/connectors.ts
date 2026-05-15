import { api } from './client.js';
import type {
  Connector,
  ConnectorList,
  RegisterConnectorRequest,
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
};
