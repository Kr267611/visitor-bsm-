import { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const role = user?.role;
  const isDesk = role === 'reception' || role === 'security' || role === 'guard' || role === 'admin';
  const isHost = role === 'employee' || role === 'reception' || role === 'security' || role === 'admin';
  return (
    <div className="shell">
      <header className="topbar">
        <strong className="brand">Visitor BSM</strong>
        <nav aria-label="Main">
          {isDesk && <NavLink to="/desk">Desk</NavLink>}
          {isHost && <NavLink to="/my">Mere visitors</NavLink>}
          {role === 'admin' && <NavLink to="/admin/users">Users</NavLink>}
          {role === 'admin' && <NavLink to="/admin/sites">Sites</NavLink>}
          {(role === 'admin' || role === 'security') && <NavLink to="/admin/devices">Devices</NavLink>}
        </nav>
        <div className="topbar-user">
          <span className="muted">{user?.name}</span>
          <button type="button" className="link" onClick={() => void logout()}>
            Logout
          </button>
        </div>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
