import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type {
  NotificationCategory,
  NotificationDeliveryChannel,
  NotificationPreference,
  PrincipalNotificationSettings,
} from '@provenance/types';
import { useOrgId } from '../../shared/hooks/useOrgId.js';
import { notificationsApi } from '../../shared/api/notifications.js';
import { CATEGORY_LABELS } from './category-labels.js';

const ALL_CATEGORIES: NotificationCategory[] = Object.keys(
  CATEGORY_LABELS,
) as NotificationCategory[];

const ALL_CHANNELS: NotificationDeliveryChannel[] = ['in_platform', 'email', 'webhook'];

/**
 * Per-principal notification preferences page at /notifications/preferences.
 * Renders one row per category with an enabled toggle and channel checkboxes,
 * plus a webhook URL setting at the top.
 */
export function NotificationPreferencesPage() {
  const orgId = useOrgId();
  const [preferences, setPreferences] = useState<Map<NotificationCategory, NotificationPreference>>(
    new Map(),
  );
  const [settings, setSettings] = useState<PrincipalNotificationSettings | null>(null);
  const [webhookUrlInput, setWebhookUrlInput] = useState('');
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [webhookError, setWebhookError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async (): Promise<void> => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [prefs, settingsResult] = await Promise.all([
        notificationsApi.preferences.list(orgId),
        notificationsApi.settings.get(orgId),
      ]);
      const map = new Map<NotificationCategory, NotificationPreference>();
      for (const p of prefs) map.set(p.category, p);
      setPreferences(map);
      setSettings(settingsResult);
      setWebhookUrlInput(settingsResult.webhookUrl ?? '');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function handleToggleEnabled(category: NotificationCategory, nextEnabled: boolean): Promise<void> {
    if (!orgId) return;
    try {
      const saved = await notificationsApi.preferences.upsert(orgId, category, {
        enabled: nextEnabled,
      });
      setPreferences((prev) => {
        const next = new Map(prev);
        next.set(category, saved);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleChannelToggle(
    category: NotificationCategory,
    channel: NotificationDeliveryChannel,
    nextEnabled: boolean,
  ): Promise<void> {
    if (!orgId) return;
    const current = preferences.get(category)?.channels ?? [];
    const next = nextEnabled
      ? Array.from(new Set([...current, channel]))
      : current.filter((c) => c !== channel);
    try {
      const saved = await notificationsApi.preferences.upsert(orgId, category, {
        channels: next,
      });
      setPreferences((prev) => {
        const updated = new Map(prev);
        updated.set(category, saved);
        return updated;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleResetCategory(category: NotificationCategory): Promise<void> {
    if (!orgId) return;
    try {
      await notificationsApi.preferences.reset(orgId, category);
      setPreferences((prev) => {
        const next = new Map(prev);
        next.delete(category);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSaveWebhook(): Promise<void> {
    if (!orgId) return;
    setSavingWebhook(true);
    setWebhookError(null);
    try {
      const saved = await notificationsApi.settings.upsert(orgId, {
        webhookUrl: webhookUrlInput.trim() === '' ? null : webhookUrlInput.trim(),
      });
      setSettings(saved);
      setWebhookUrlInput(saved.webhookUrl ?? '');
    } catch (err) {
      setWebhookError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingWebhook(false);
    }
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Notification Preferences</h1>
        <Link to="/notifications" className="text-sm text-brand-600 hover:text-brand-700">
          Back to inbox
        </Link>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Webhook URL */}
      <section className="mb-8 p-4 bg-white rounded border border-slate-200">
        <h2 className="text-sm font-semibold text-slate-900 mb-2">Webhook URL</h2>
        <p className="text-xs text-slate-600 mb-3">
          When you opt into the <code className="text-xs bg-slate-100 px-1 rounded">webhook</code>{' '}
          channel for a category below, the platform will POST a JSON envelope
          to this URL. Must use https. Leave blank to disable webhook delivery.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="url"
            value={webhookUrlInput}
            onChange={(event) => setWebhookUrlInput(event.target.value)}
            placeholder="https://hooks.example.com/your-endpoint"
            className="flex-1 text-sm border border-slate-300 rounded px-2 py-1.5"
          />
          <button
            type="button"
            onClick={() => { void handleSaveWebhook(); }}
            disabled={savingWebhook || webhookUrlInput === (settings?.webhookUrl ?? '')}
            className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-sm rounded disabled:opacity-50"
          >
            {savingWebhook ? 'Saving…' : 'Save'}
          </button>
        </div>
        {webhookError && (
          <p className="mt-2 text-xs text-red-600">{webhookError}</p>
        )}
      </section>

      {/* Per-category preferences */}
      <section className="bg-white rounded border border-slate-200">
        <div className="px-4 py-3 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">By category</h2>
          <p className="text-xs text-slate-600 mt-1">
            Categories without an explicit preference use the platform default.
            The in-platform inbox always receives notifications regardless of
            settings — opt-out only suppresses out-of-band channels (email and
            webhook).
          </p>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-xs text-slate-500 uppercase">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Category</th>
                <th className="text-center px-2 py-2 font-medium">Enabled</th>
                {ALL_CHANNELS.map((channel) => (
                  <th key={channel} className="text-center px-2 py-2 font-medium">
                    {channel.replace('_', '-')}
                  </th>
                ))}
                <th className="text-right px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ALL_CATEGORIES.map((category) => {
                const pref = preferences.get(category);
                const enabled = pref?.enabled ?? true;
                const overrideChannels = pref?.channels ?? [];
                const isOverridden = overrideChannels.length > 0;
                return (
                  <tr key={category}>
                    <td className="px-4 py-3 text-slate-900">
                      {CATEGORY_LABELS[category]}
                      {isOverridden && (
                        <span className="ml-2 text-xs text-slate-500">(custom channels)</span>
                      )}
                    </td>
                    <td className="text-center px-2 py-3">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(event) => {
                          void handleToggleEnabled(category, event.target.checked);
                        }}
                        aria-label={`Enable ${CATEGORY_LABELS[category]}`}
                      />
                    </td>
                    {ALL_CHANNELS.map((channel) => {
                      const checked = isOverridden && overrideChannels.includes(channel);
                      return (
                        <td key={channel} className="text-center px-2 py-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              void handleChannelToggle(category, channel, event.target.checked);
                            }}
                            disabled={!enabled}
                            aria-label={`${channel} for ${CATEGORY_LABELS[category]}`}
                          />
                        </td>
                      );
                    })}
                    <td className="text-right px-4 py-3">
                      {pref && (
                        <button
                          type="button"
                          onClick={() => { void handleResetCategory(category); }}
                          className="text-xs text-slate-500 hover:text-slate-700"
                        >
                          Reset
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
