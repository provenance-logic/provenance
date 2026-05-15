import { api } from './client.js';

export interface SampleDataResponse {
  created: {
    domains: number;
    products: number;
    ports: number;
    slos: number;
    notifications: number;
  };
  domainId: string;
  productIds: string[];
}

export const sampleDataApi = {
  populate: (orgId: string) =>
    api.post<SampleDataResponse>(
      `/organizations/${encodeURIComponent(orgId)}/sample-data`,
      {},
    ),
};
