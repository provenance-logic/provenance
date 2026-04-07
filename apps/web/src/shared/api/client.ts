import keycloak from '../../auth/keycloak.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL as string;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Ensure the Keycloak token is fresh before every request. updateToken is a
  // no-op when the token still has > 30 s of validity; otherwise it silently
  // refreshes. This prevents 401s caused by stale tokens between background
  // refresh intervals.
  try { await keycloak.updateToken(30); } catch { /* refresh failed — proceed with current token, guard will 401 */ }

  const token = keycloak.token;
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (!res.ok) {
    const body: unknown = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { message?: string }).message ?? res.statusText, body);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path: string) => request<void>(path, { method: 'DELETE' }),
};
