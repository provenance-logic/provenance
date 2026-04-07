import { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthProvider.js';
import { organizationsApi } from '../api/organizations.js';

/**
 * Resolves the current org ID. Prefers the JWT provenance_org_id claim;
 * falls back to fetching the first org from the API.
 */
export function useOrgId(): string | undefined {
  const { keycloak } = useAuth();
  const fromToken = keycloak.tokenParsed?.provenance_org_id as string | undefined;
  const [resolved, setResolved] = useState<string | undefined>(fromToken || undefined);

  useEffect(() => {
    if (fromToken) {
      setResolved(fromToken);
      return;
    }
    organizationsApi.list(1, 0).then((res) => {
      if (res.items.length > 0) setResolved(res.items[0].id);
    }).catch(() => {});
  }, [fromToken]);

  return resolved;
}
