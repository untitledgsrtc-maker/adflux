// =====================================================================
// AppShell — sidebar + topbar + outlet. Visible only when authenticated.
// =====================================================================

import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';

const NAV = [
  { to: '/',          label: 'Dashboard',  always: true },
  { to: '/proposals', label: 'Proposals',  always: true },
  { to: '/payments',  label: 'Payments',   always: true },
  { to: '/clients',   label: 'Clients',    always: true },
  { to: '/masters',   label: 'Masters',    requiresAdmin: true },
  { to: '/pnl',       label: 'P&L',        requiresPnl: true },
  { to: '/admin',     label: 'Admin',      requiresOwner: true },
];

export default function AppShell() {
  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);
  const navigate = useNavigate();

  if (!profile) return null;

  const filteredNav = NAV.filter((item) => {
    if (item.requiresOwner) return profile.role === 'owner';
    if (item.requiresPnl)   return ['owner', 'co_owner'].includes(profile.role);
    if (item.requiresAdmin) return ['owner', 'co_owner', 'admin'].includes(profile.role);
    return true;
  });

  return (
    <div className="up-shell">
      <aside className="up-shell__sidebar">
        <div style={{ padding: '20px 20px 8px', borderBottom: '1px solid var(--up-line-soft)' }}>
          <div style={{ fontFamily: 'var(--up-font-display)', fontWeight: 700, fontSize: 18, letterSpacing: '-0.02em' }}>
            Untitled
          </div>
          <div style={{ fontSize: 11, color: 'var(--up-ink-soft)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Proposals
          </div>
        </div>
        <nav style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {filteredNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              style={({ isActive }) => ({
                padding: '8px 12px',
                borderRadius: 6,
                color: isActive ? 'var(--up-accent-deep)' : 'var(--up-ink-2)',
                background: isActive ? 'var(--up-accent-faint)' : 'transparent',
                fontWeight: isActive ? 600 : 500,
                fontSize: 14,
                textDecoration: 'none',
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <header className="up-shell__topbar">
        <div style={{ flex: 1 }} />
        <div className="up-row" style={{ gap: 16 }}>
          <span style={{ fontSize: 13, color: 'var(--up-ink-muted)' }}>
            {profile.full_name} · <span style={{ textTransform: 'capitalize' }}>{profile.role.replace('_', ' ')}</span>
          </span>
          <button
            type="button"
            className="up-btn up-btn--sm"
            onClick={async () => {
              await signOut();
              navigate('/login');
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="up-shell__main">
        <Outlet />
      </main>
    </div>
  );
}
