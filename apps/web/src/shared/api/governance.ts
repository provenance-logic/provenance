import { api } from './client.js';
import type {
  GovernanceDashboard,
  ComplianceStateList,
  ComplianceState,
  PolicyVersionList,
  PolicyVersion,
  PublishPolicyRequest,
  PolicyImpactPreview,
  PolicyImpactPreviewRequest,
  EffectivePolicyList,
  EffectivePolicy,
  ExceptionList,
  Exception,
  GrantExceptionRequest,
  GracePeriodList,
  EvaluationResult,
  TriggerEvaluationRequest,
  PolicyDomain,
  ComplianceStateValue,
  GracePeriodOutcome,
  PolicyScopeType,
} from '@provenance/types';

const base = (orgId: string) => `/organizations/${orgId}/governance`;

export const governanceApi = {
  dashboard: (orgId: string): Promise<GovernanceDashboard> =>
    api.get<GovernanceDashboard>(`${base(orgId)}/dashboard`),

  compliance: {
    list: (
      orgId: string,
      state?: ComplianceStateValue,
      domainId?: string,
      limit = 100,
      offset = 0,
    ): Promise<ComplianceStateList> => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (state) params.set('state', state);
      if (domainId) params.set('domainId', domainId);
      return api.get<ComplianceStateList>(`${base(orgId)}/compliance?${params.toString()}`);
    },

    get: (orgId: string, productId: string): Promise<ComplianceState> =>
      api.get<ComplianceState>(`${base(orgId)}/compliance/${productId}`),

    evaluate: (orgId: string, dto: TriggerEvaluationRequest): Promise<EvaluationResult> =>
      api.post<EvaluationResult>(`${base(orgId)}/compliance/evaluate`, dto),
  },

  policies: {
    listVersions: (
      orgId: string,
      policyDomain?: PolicyDomain,
      limit = 20,
      offset = 0,
    ): Promise<PolicyVersionList> => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (policyDomain) params.set('policyDomain', policyDomain);
      return api.get<PolicyVersionList>(`${base(orgId)}/policy-versions?${params.toString()}`);
    },

    publish: (orgId: string, dto: PublishPolicyRequest): Promise<PolicyVersion> =>
      api.post<PolicyVersion>(`${base(orgId)}/policy-versions`, dto),

    preview: (orgId: string, dto: PolicyImpactPreviewRequest): Promise<PolicyImpactPreview> =>
      api.post<PolicyImpactPreview>(`${base(orgId)}/policy-preview`, dto),

    listEffective: (
      orgId: string,
      scopeType?: PolicyScopeType,
      limit = 20,
      offset = 0,
    ): Promise<EffectivePolicyList> => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (scopeType) params.set('scopeType', scopeType);
      return api.get<EffectivePolicyList>(`${base(orgId)}/effective-policies?${params.toString()}`);
    },

    getEffective: (orgId: string, policyDomain: PolicyDomain): Promise<EffectivePolicy> =>
      api.get<EffectivePolicy>(`${base(orgId)}/effective-policies/${policyDomain}`),
  },

  exceptions: {
    list: (
      orgId: string,
      productId?: string,
      active?: boolean,
      limit = 20,
      offset = 0,
    ): Promise<ExceptionList> => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (productId) params.set('productId', productId);
      if (active !== undefined) params.set('active', String(active));
      return api.get<ExceptionList>(`${base(orgId)}/exceptions?${params.toString()}`);
    },

    grant: (orgId: string, dto: GrantExceptionRequest): Promise<Exception> =>
      api.post<Exception>(`${base(orgId)}/exceptions`, dto),

    revoke: (orgId: string, exceptionId: string): Promise<Exception> =>
      api.delete(`${base(orgId)}/exceptions/${exceptionId}`) as Promise<Exception>,
  },

  gracePeriods: {
    list: (
      orgId: string,
      outcome?: GracePeriodOutcome,
      limit = 20,
      offset = 0,
    ): Promise<GracePeriodList> => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (outcome) params.set('outcome', outcome);
      return api.get<GracePeriodList>(`${base(orgId)}/grace-periods?${params.toString()}`);
    },
  },
};
