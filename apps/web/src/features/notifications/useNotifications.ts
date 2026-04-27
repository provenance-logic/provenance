import { useEffect, useState, useCallback, useRef } from 'react';
import { useOrgId } from '../../shared/hooks/useOrgId.js';
import { notificationsApi, type ListFilters } from '../../shared/api/notifications.js';
import type { Notification, NotificationList } from '@provenance/types';

interface UseNotificationsOptions {
  filters?: ListFilters;
  /**
   * Polling interval in ms. Defaults to 30s — matches the worker drain
   * cadence so a freshly written notification appears within one tick.
   * Set to 0 to disable polling (one-shot fetch only).
   */
  pollIntervalMs?: number;
}

interface UseNotificationsResult {
  data: NotificationList | null;
  loading: boolean;
  error: string | null;
  unreadCount: number;
  refresh: () => Promise<void>;
  markRead: (notificationId: string) => Promise<void>;
  dismiss: (notificationId: string) => Promise<void>;
}

/**
 * Loads (and optionally polls) the calling principal's notification inbox.
 * Provides optimistic actions for mark-read and dismiss — the local state
 * updates immediately; on API failure the next poll reconciles.
 */
export function useNotifications(
  options: UseNotificationsOptions = {},
): UseNotificationsResult {
  const orgId = useOrgId();
  const pollIntervalMs = options.pollIntervalMs ?? 30_000;
  const filtersRef = useRef<ListFilters>(options.filters ?? {});
  filtersRef.current = options.filters ?? {};

  const [data, setData] = useState<NotificationList | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!orgId) return;
    try {
      const result = await notificationsApi.list(orgId, filtersRef.current);
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (pollIntervalMs <= 0) return;
    const interval = window.setInterval(() => {
      void refresh();
    }, pollIntervalMs);
    return () => window.clearInterval(interval);
  }, [refresh, pollIntervalMs]);

  const markRead = useCallback(
    async (notificationId: string): Promise<void> => {
      if (!orgId) return;
      // Optimistic update — flip readAt locally so the unread badge drops
      // immediately. The next refresh reconciles if the server disagrees.
      setData((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((n) =>
                n.id === notificationId && !n.readAt
                  ? { ...n, readAt: new Date().toISOString() }
                  : n,
              ),
            }
          : prev,
      );
      try {
        await notificationsApi.markRead(orgId, notificationId);
      } catch {
        // Roll back on failure by re-fetching.
        await refresh();
      }
    },
    [orgId, refresh],
  );

  const dismiss = useCallback(
    async (notificationId: string): Promise<void> => {
      if (!orgId) return;
      // Optimistic remove from the list since the default filters exclude
      // dismissed notifications.
      setData((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.filter((n) => n.id !== notificationId),
              meta: { ...prev.meta, total: Math.max(0, prev.meta.total - 1) },
            }
          : prev,
      );
      try {
        await notificationsApi.dismiss(orgId, notificationId);
      } catch {
        await refresh();
      }
    },
    [orgId, refresh],
  );

  const unreadCount = (data?.items ?? []).filter((n: Notification) => !n.readAt).length;

  return { data, loading, error, unreadCount, refresh, markRead, dismiss };
}
