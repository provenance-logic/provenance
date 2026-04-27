import { api } from './client.js';
import type {
  Notification,
  NotificationCategory,
  NotificationList,
  NotificationPreference,
  PrincipalNotificationSettings,
  UpdateNotificationPreferenceRequest,
  UpdatePrincipalNotificationSettingsRequest,
} from '@provenance/types';

const base = (orgId: string) => `/organizations/${orgId}/notifications`;

export interface ListFilters {
  category?: NotificationCategory;
  unreadOnly?: boolean;
  excludeDismissed?: boolean;
  limit?: number;
  offset?: number;
}

function buildListQuery(filters: ListFilters): string {
  const params = new URLSearchParams();
  if (filters.category) params.set('category', filters.category);
  if (filters.unreadOnly !== undefined) params.set('unreadOnly', String(filters.unreadOnly));
  if (filters.excludeDismissed !== undefined) {
    params.set('excludeDismissed', String(filters.excludeDismissed));
  }
  params.set('limit', String(filters.limit ?? 20));
  params.set('offset', String(filters.offset ?? 0));
  return params.toString();
}

export const notificationsApi = {
  list: (orgId: string, filters: ListFilters = {}): Promise<NotificationList> =>
    api.get<NotificationList>(`${base(orgId)}?${buildListQuery(filters)}`),

  markRead: (orgId: string, notificationId: string): Promise<Notification> =>
    api.post<Notification>(`${base(orgId)}/${notificationId}/read`, {}),

  dismiss: (orgId: string, notificationId: string): Promise<Notification> =>
    api.post<Notification>(`${base(orgId)}/${notificationId}/dismiss`, {}),

  preferences: {
    list: (orgId: string): Promise<NotificationPreference[]> =>
      api.get<NotificationPreference[]>(`${base(orgId)}/preferences`),

    upsert: (
      orgId: string,
      category: NotificationCategory,
      body: UpdateNotificationPreferenceRequest,
    ): Promise<NotificationPreference> =>
      // PUT is not in the existing api helper — fall through via fetch.
      apiPut<NotificationPreference>(`${base(orgId)}/preferences/${category}`, body),

    reset: (orgId: string, category: NotificationCategory): Promise<void> =>
      api.delete(`${base(orgId)}/preferences/${category}`),
  },

  settings: {
    get: (orgId: string): Promise<PrincipalNotificationSettings> =>
      api.get<PrincipalNotificationSettings>(`${base(orgId)}/settings`),

    upsert: (
      orgId: string,
      body: UpdatePrincipalNotificationSettingsRequest,
    ): Promise<PrincipalNotificationSettings> =>
      apiPut<PrincipalNotificationSettings>(`${base(orgId)}/settings`, body),
  },
};

// PUT helper. The shared api client lacks one (existing endpoints use POST or
// PATCH). Mirrors the patterns in client.ts.
async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const { default: keycloak } = await import('../../auth/keycloak.js');
  const apiBase = import.meta.env.VITE_API_BASE_URL as string;
  try { await keycloak.updateToken(30); } catch { /* refresh failed; let server 401 */ }
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (keycloak.token) headers.set('Authorization', `Bearer ${keycloak.token}`);
  const res = await fetch(`${apiBase}${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const responseBody: unknown = await res.json().catch(() => ({}));
    throw new Error(
      (responseBody as { message?: string }).message ?? res.statusText,
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
