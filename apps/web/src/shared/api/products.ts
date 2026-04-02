import { api } from './client.js';
import type {
  DataProduct,
  DataProductList,
  CreateDataProductRequest,
  UpdateDataProductRequest,
  DataProductStatus,
  Port,
  PortList,
  DeclarePortRequest,
  UpdatePortRequest,
  ProductVersionList,
} from '@meshos/types';

const base = (orgId: string, domainId: string) =>
  `/organizations/${orgId}/domains/${domainId}/products`;

export const productsApi = {
  list: (orgId: string, domainId: string, status?: DataProductStatus, limit = 20, offset = 0) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (status) params.set('status', status);
    return api.get<DataProductList>(`${base(orgId, domainId)}?${params}`);
  },

  create: (orgId: string, domainId: string, dto: CreateDataProductRequest) =>
    api.post<DataProduct>(base(orgId, domainId), dto),

  get: (orgId: string, domainId: string, productId: string) =>
    api.get<DataProduct>(`${base(orgId, domainId)}/${productId}`),

  update: (orgId: string, domainId: string, productId: string, dto: UpdateDataProductRequest) =>
    api.patch<DataProduct>(`${base(orgId, domainId)}/${productId}`, dto),

  delete: (orgId: string, domainId: string, productId: string) =>
    api.delete(`${base(orgId, domainId)}/${productId}`),

  ports: {
    list: (orgId: string, domainId: string, productId: string) =>
      api.get<PortList>(`${base(orgId, domainId)}/${productId}/ports`),

    declare: (orgId: string, domainId: string, productId: string, dto: DeclarePortRequest) =>
      api.post<Port>(`${base(orgId, domainId)}/${productId}/ports`, dto),

    update: (orgId: string, domainId: string, productId: string, portId: string, dto: UpdatePortRequest) =>
      api.patch<Port>(`${base(orgId, domainId)}/${productId}/ports/${portId}`, dto),

    delete: (orgId: string, domainId: string, productId: string, portId: string) =>
      api.delete(`${base(orgId, domainId)}/${productId}/ports/${portId}`),
  },

  versions: {
    list: (orgId: string, domainId: string, productId: string) =>
      api.get<ProductVersionList>(`${base(orgId, domainId)}/${productId}/versions`),
  },
};
