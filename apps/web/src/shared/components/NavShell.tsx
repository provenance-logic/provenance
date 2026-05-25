import { NavLink, Outlet } from 'react-router-dom';
import { NotificationBell } from '../../features/notifications/NotificationBell.js';
import { UserMenu } from './UserMenu.js';

interface NavItem {
  to: string;
  label: string;
}

const navItems: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/connectors', label: 'Connectors' },
  { to: '/marketplace', label: 'Marketplace' },
  { to: '/access-requests', label: 'Access Requests' },
  { to: '/governance', label: 'Governance' },
  { to: '/agents', label: 'Agents' },
];

export function NavShell() {
  return (
    <div className="flex h-screen bg-slate-50">
      {/* Sidebar */}
      <nav className="w-56 flex-shrink-0 bg-slate-900 flex flex-col">
        <div className="px-4 py-5">
          {/* The brand logo is all-navy (icon + wordmark), so it would vanish
              on the navy sidebar. Sit it on a white card to keep the brand
              colors intact and legible. Asset lives in apps/web/public/. */}
          <div className="rounded-lg bg-white px-3 py-2 flex items-center justify-start">
            <img
              src="/Provenance-Logo.svg"
              alt="Provenance"
              className="h-8 w-auto"
            />
          </div>
        </div>

        <ul className="flex-1 px-3 space-y-1">
          {navItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-brand-700 text-white'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
          <li className="pt-2">
            <NotificationBell />
          </li>
        </ul>

        <div className="px-2 py-3 border-t border-slate-700">
          {/* F7.48 — sidebar-bottom avatar dropdown. Replaces the prior
              naked Sign-out button; surfaces who you're signed in as and
              routes to /account for the full profile + change-password. */}
          <UserMenu />
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
