import { useState, useRef, useEffect } from 'react';
import { useNotifications } from './useNotifications.js';
import { NotificationDrawer } from './NotificationDrawer.js';

/**
 * Bell icon with unread count badge. Mounted in the NavShell sidebar.
 * Click toggles the NotificationDrawer overlay.
 */
export function NotificationBell() {
  const { data, loading, unreadCount, markRead, dismiss, refresh } = useNotifications({
    filters: { limit: 20 },
  });
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close drawer on outside click.
  useEffect(() => {
    if (!open) return;
    function handler(event: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="relative w-full flex items-center px-3 py-2 rounded-md text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <BellIcon />
        <span className="ml-2">Notifications</span>
        {unreadCount > 0 && (
          <span className="ml-auto inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 text-xs font-semibold rounded-full bg-red-500 text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <NotificationDrawer
          items={data?.items ?? []}
          loading={loading}
          onMarkRead={(id) => { void markRead(id); }}
          onDismiss={(id) => { void dismiss(id); }}
          onRefresh={() => { void refresh(); }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4"
      aria-hidden="true"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
