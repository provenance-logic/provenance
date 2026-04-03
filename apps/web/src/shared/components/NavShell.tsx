import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider.js';

interface NavItem {
  to: string;
  label: string;
}

const navItems: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/products', label: 'Data Products' },
  { to: '/marketplace', label: 'Marketplace' },
  { to: '/governance', label: 'Governance' },
  { to: '/agents', label: 'Agents' },
];

export function NavShell() {
  const { keycloak } = useAuth();

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Sidebar */}
      <nav className="w-56 flex-shrink-0 bg-slate-900 flex flex-col">
        <div className="px-6 py-5">
          <span className="text-white font-semibold text-lg tracking-tight">Provenance</span>
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
        </ul>

        <div className="px-4 py-4 border-t border-slate-700">
          <button
            onClick={() => keycloak.logout()}
            className="w-full text-left text-sm text-slate-400 hover:text-white transition-colors"
          >
            Sign out
          </button>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
