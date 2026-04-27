import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { NotificationCategory } from '@provenance/types';
import { useNotifications } from './useNotifications.js';
import {
  CATEGORY_LABELS,
  formatPayloadEntries,
  formatRelativeTime,
} from './category-labels.js';

const PAGE_SIZE = 20;

/**
 * Full-page notification inbox at /notifications. Adds category filter,
 * unread-only and include-dismissed toggles, and a more detailed view of
 * each notification's payload than the drawer shows.
 */
export function NotificationsPage() {
  const [category, setCategory] = useState<NotificationCategory | ''>('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [excludeDismissed, setExcludeDismissed] = useState(true);
  const [offset, setOffset] = useState(0);

  const { data, loading, error, markRead, dismiss, refresh } = useNotifications({
    filters: {
      ...(category !== '' && { category }),
      unreadOnly,
      excludeDismissed,
      limit: PAGE_SIZE,
      offset,
    },
  });

  const total = data?.meta.total ?? 0;
  const items = data?.items ?? [];

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Notifications</h1>
        <Link
          to="/notifications/preferences"
          className="text-sm text-brand-600 hover:text-brand-700"
        >
          Preferences
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 mb-4 p-3 bg-white rounded border border-slate-200">
        <label className="text-sm flex items-center gap-2">
          <span className="text-slate-700">Category</span>
          <select
            value={category}
            onChange={(event) => {
              setCategory(event.target.value as NotificationCategory | '');
              setOffset(0);
            }}
            className="text-sm border border-slate-300 rounded px-2 py-1"
          >
            <option value="">All</option>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm flex items-center gap-2">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(event) => {
              setUnreadOnly(event.target.checked);
              setOffset(0);
            }}
          />
          <span className="text-slate-700">Unread only</span>
        </label>
        <label className="text-sm flex items-center gap-2">
          <input
            type="checkbox"
            checked={!excludeDismissed}
            onChange={(event) => {
              setExcludeDismissed(!event.target.checked);
              setOffset(0);
            }}
          />
          <span className="text-slate-700">Show dismissed</span>
        </label>
        <button
          type="button"
          onClick={() => { void refresh(); }}
          className="ml-auto text-sm text-slate-500 hover:text-slate-700"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
      ) : items.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-500 bg-white rounded border border-slate-200">
          No notifications match your filters.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((notification) => {
            const isUnread = !notification.readAt;
            const categoryLabel =
              CATEGORY_LABELS[notification.category] ?? notification.category;
            const payloadEntries = formatPayloadEntries(notification.payload);
            return (
              <li
                key={notification.id}
                className={`p-4 rounded border border-slate-200 ${isUnread ? 'bg-blue-50' : 'bg-white'}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <Link
                      to={notification.deepLink}
                      onClick={() => { if (isUnread) void markRead(notification.id); }}
                      className="text-sm font-semibold text-slate-900 hover:text-brand-700"
                    >
                      {categoryLabel}
                    </Link>
                    {notification.dedupCount > 1 && (
                      <span className="ml-2 text-xs text-slate-500">
                        ×{notification.dedupCount} occurrences
                      </span>
                    )}
                    {payloadEntries.length > 0 && (
                      <ul className="mt-2 text-xs text-slate-600 space-y-0.5">
                        {payloadEntries.map(({ key, value }) => (
                          <li key={key}>
                            <span className="text-slate-500">{key}:</span>{' '}
                            <span className="text-slate-800">{value}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-2 text-xs text-slate-500">
                      {formatRelativeTime(notification.createdAt)}
                      {notification.readAt && (
                        <span className="ml-2">· read {formatRelativeTime(notification.readAt)}</span>
                      )}
                      {notification.dismissedAt && (
                        <span className="ml-2">· dismissed {formatRelativeTime(notification.dismissedAt)}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1 text-xs">
                    {isUnread && (
                      <button
                        type="button"
                        onClick={() => { void markRead(notification.id); }}
                        className="text-slate-500 hover:text-slate-700"
                      >
                        Mark read
                      </button>
                    )}
                    {!notification.dismissedAt && (
                      <button
                        type="button"
                        onClick={() => { void dismiss(notification.id); }}
                        className="text-slate-500 hover:text-red-600"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0}
            className="text-slate-500 hover:text-slate-700 disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-slate-500">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <button
            type="button"
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total}
            className="text-slate-500 hover:text-slate-700 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
