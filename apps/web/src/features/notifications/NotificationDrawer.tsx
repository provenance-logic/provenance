import { Link } from 'react-router-dom';
import type { Notification } from '@provenance/types';
import { CATEGORY_LABELS, formatRelativeTime } from './category-labels.js';

interface NotificationDrawerProps {
  items: Notification[];
  loading: boolean;
  onMarkRead: (notificationId: string) => void;
  onDismiss: (notificationId: string) => void;
  onRefresh: () => void;
  onClose: () => void;
}

/**
 * Popover drawer rendered alongside the NotificationBell. Lists the most
 * recent notifications with mark-read and dismiss controls. Clicking a
 * notification's deep link marks it read and navigates.
 */
export function NotificationDrawer({
  items,
  loading,
  onMarkRead,
  onDismiss,
  onRefresh,
  onClose,
}: NotificationDrawerProps) {
  return (
    <div
      className="absolute left-full top-0 ml-2 w-96 max-h-[80vh] overflow-y-auto bg-white rounded-md shadow-xl border border-slate-200 z-50"
      role="dialog"
      aria-label="Notifications"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
        <span className="text-sm font-semibold text-slate-900">Notifications</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            Refresh
          </button>
          <Link
            to="/notifications"
            onClick={onClose}
            className="text-xs text-brand-600 hover:text-brand-700"
          >
            View all
          </Link>
        </div>
      </div>

      {loading && items.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-slate-500">Loading…</div>
      ) : items.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-slate-500">
          No notifications yet.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              onMarkRead={onMarkRead}
              onDismiss={onDismiss}
              onNavigate={onClose}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface NotificationRowProps {
  notification: Notification;
  onMarkRead: (notificationId: string) => void;
  onDismiss: (notificationId: string) => void;
  onNavigate: () => void;
}

function NotificationRow({
  notification,
  onMarkRead,
  onDismiss,
  onNavigate,
}: NotificationRowProps) {
  const isUnread = !notification.readAt;
  const categoryLabel = CATEGORY_LABELS[notification.category] ?? notification.category;

  return (
    <li className={`px-4 py-3 ${isUnread ? 'bg-blue-50' : 'bg-white'}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {isUnread && (
              <span className="w-2 h-2 rounded-full bg-blue-500" aria-label="unread" />
            )}
            <Link
              to={notification.deepLink}
              onClick={() => {
                if (isUnread) onMarkRead(notification.id);
                onNavigate();
              }}
              className="text-sm font-medium text-slate-900 hover:text-brand-700 truncate"
            >
              {categoryLabel}
            </Link>
          </div>
          {notification.dedupCount > 1 && (
            <p className="mt-0.5 text-xs text-slate-500">
              ×{notification.dedupCount} occurrences
            </p>
          )}
          <p className="mt-1 text-xs text-slate-500">
            {formatRelativeTime(notification.createdAt)}
          </p>
        </div>
        <div className="flex flex-col gap-1 text-xs">
          {isUnread && (
            <button
              type="button"
              onClick={() => onMarkRead(notification.id)}
              className="text-slate-500 hover:text-slate-700"
            >
              Mark read
            </button>
          )}
          <button
            type="button"
            onClick={() => onDismiss(notification.id)}
            className="text-slate-500 hover:text-red-600"
          >
            Dismiss
          </button>
        </div>
      </div>
    </li>
  );
}
