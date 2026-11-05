import type { Role } from '@visitor/shared';
import { ReactNode, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { LiveSiteProvider, useLiveOptional } from '../desk/LiveSiteContext';

const DESK_ROLES: Role[] = ['reception', 'security', 'guard', 'admin'];
const HOST_ROLES: Role[] = ['employee', 'reception', 'security', 'admin'];

interface MenuLinkProps {
  to: string;
  label: string;
  count?: number;
  urgent?: boolean;
  end?: boolean;
  onPick(): void;
}

function MenuLink({ to, label, count, urgent, end, onPick }: MenuLinkProps) {
  return (
    <NavLink to={to} end={end} onClick={onPick} className="menu-link">
      <span>{label}</span>{' '}
      {count !== undefined && <span className={`menu-count ${urgent ? 'menu-count-urgent' : ''}`}>{count}</span>}
    </NavLink>
  );
}

function MenuGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="menu-group">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function Shell() {
  const { user, logout } = useAuth();
  const live = useLiveOptional();
  const [open, setOpen] = useState(false);
  const role = user?.role as Role;
  const close = () => setOpen(false);

  const data = live?.query.data;
  const approvals = data ? data.pending.length + data.needsCall.length : undefined;

  return (
    <div className="shell">
      <div className="mobile-bar">
        <strong className="brand">Visitor BSM</strong>
        <button type="button" aria-expanded={open} aria-controls="side-menu" onClick={() => setOpen(!open)}>
          Menu
        </button>
      </div>

      <aside id="side-menu" className={`sidebar ${open ? 'sidebar-open' : ''}`}>
        <strong className="brand sidebar-brand">Visitor BSM</strong>
        <nav aria-label="Main">
          {DESK_ROLES.includes(role) && (
            <MenuGroup title="Gate desk">
              <MenuLink to="/desk/pending" label="Approval baaki" count={approvals} urgent={!!data?.needsCall.length} onPick={close} />
              <MenuLink to="/desk/expected" label="Aane wale" count={data?.expected.length} onPick={close} />
              <MenuLink to="/desk/inside" label="Andar hain" count={data?.inside.length} onPick={close} />
            </MenuGroup>
          )}
          {HOST_ROLES.includes(role) && (
            <MenuGroup title="Mere visitors">
              <MenuLink to="/my" end label="Visitors ki list" onPick={close} />
              {role !== 'security' && <MenuLink to="/my/invite" label="Naya invite" onPick={close} />}
              <MenuLink to="/my/backup" label="Backup person" onPick={close} />
            </MenuGroup>
          )}
          {(role === 'admin' || role === 'security') && (
            <MenuGroup title="Admin">
              {role === 'admin' && <MenuLink to="/admin/users" label="Users" onPick={close} />}
              {role === 'admin' && <MenuLink to="/admin/sites" label="Sites aur gates" onPick={close} />}
              <MenuLink to="/admin/devices" label="Devices" onPick={close} />
            </MenuGroup>
          )}
        </nav>
        <div className="sidebar-user">
          <span className="muted">{user?.name}</span>
          <button type="button" className="link" onClick={() => void logout()}>
            Logout
          </button>
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

export function Layout() {
  const { user } = useAuth();
  return user && DESK_ROLES.includes(user.role) ? (
    <LiveSiteProvider>
      <Shell />
    </LiveSiteProvider>
  ) : (
    <Shell />
  );
}
