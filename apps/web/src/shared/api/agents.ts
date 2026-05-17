import { api } from './client.js';

export interface AgentResponse {
  agent_id: string;
  org_id: string;
  display_name: string;
  model_name: string;
  model_provider: string;
  human_oversight_contact: string;
  registered_by_principal_id: string;
  current_classification: 'Observed' | 'Supervised' | 'Autonomous';
  classification_scope: string;
  classification_changed_at: string | null;
  classification_reason: string | null;
  keycloak_client_id: string;
  keycloak_client_secret: string | null;
  created_at: string;
  updated_at: string;
}

export interface RegisterAgentRequest {
  display_name: string;
  model_name: string;
  model_provider: string;
  human_oversight_contact: string;
  org_id: string;
}

export interface ClassificationHistoryEntry {
  classification_id: string;
  agent_id: string;
  classification: 'Observed' | 'Supervised' | 'Autonomous';
  scope: string;
  changed_by_principal_id: string;
  changed_by_principal_type: string;
  reason: string | null;
  effective_from: string;
  effective_until: string | null;
}

export const agentsApi = {
  list: (orgId: string) =>
    api.get<AgentResponse[]>(`/agents?orgId=${encodeURIComponent(orgId)}`),
  register: (dto: RegisterAgentRequest) =>
    api.post<AgentResponse>('/agents', dto),
  get: (agentId: string) =>
    api.get<AgentResponse>(`/agents/${encodeURIComponent(agentId)}`),
  classificationHistory: (agentId: string) =>
    api.get<ClassificationHistoryEntry[]>(
      `/agents/${encodeURIComponent(agentId)}/classification/history`,
    ),
};
