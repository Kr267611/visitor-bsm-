import type { Profile, Role } from '@visitor/shared';
import { useQuery } from '@tanstack/react-query';
import { ReactNode, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useApi } from '../api';
import { useAuth } from '../auth/AuthProvider';
import { useModules } from '../auth/RequireModule';
import { LiveSiteProvider, useLiveOptional } from '../desk/LiveSiteContext';
import { initials, ROLE_LABEL } from './Page';

const DESK_ROLES: Role[] = ['reception', 'security', 'guard', 'admin'];

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

const BOTTOM_ICONS: Record<string, ReactNode> = {
  home: <path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" />,
  gate: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2" />,
  people: <path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1M16 4.5a3.5 3.5 0 0 1 0 6.5M21 20v-1a5 5 0 0 0-3-4.6" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3" />,
};

function BottomIcon({ name }: { name: keyof typeof BOTTOM_ICONS }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {BOTTOM_ICONS[name]}
    </svg>
  );
}

function BottomLink({ to, label, icon, count, onPick }: { to: string; label: string; icon: keyof typeof BOTTOM_ICONS; count?: number; onPick(): void }) {
  return (
    <NavLink to={to} aria-label={label} title={label} onClick={onPick} className="bottom-item">
      <BottomIcon name={icon} />
      {!!count && <span className="bottom-count">{count}</span>}
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

/** Profile (business, premises, plan modules). One query for the whole app. */
export function useProfile() {
  const api = useApi();
  return useQuery<Profile>({ queryKey: ['me'], queryFn: () => api.me.get() });
}

/** Is the module in the plan? Without a profile we keep the menu; the server still answers 403. */
export function useFeature() {
  const profile = useProfile();
  const features = profile.data?.features;
  return (feature: string) => !Array.isArray(features) || features.includes(feature);
}

function PremisesSwitcher({ profile }: { profile: Profile }) {
  const { premisesId, switchPremises } = useAuth();
  const list = Array.isArray(profile.premises) ? profile.premises : [];
  if (list.length < 2) return list[0] ? <span className="muted small premises-name">{list[0].name}</span> : null;
  const active = premisesId ?? profile.activePremisesId ?? '';
  return (
    <div className="stack premises-switch">
      <label htmlFor="premises-switch" className="muted small">
        Premises
      </label>
      <select id="premises-switch" value={active} onChange={(e) => switchPremises(e.target.value)}>
        {list.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function Shell() {
  const { user, logout } = useAuth();
  const live = useLiveOptional();
  const profile = useProfile();
  const has = useFeature();
  const { modules } = useModules();
  const can = (m: (typeof modules)[number]) => modules.includes(m);
  const [open, setOpen] = useState(false);
  const role = user?.role as Role;
  const close = () => setOpen(false);

  const data = live?.query.data;
  const approvals = data ? data.pending.length + data.needsCall.length : undefined;
  const businessName = profile.data?.business?.name;

  return (
    <div className="shell">
      <div className="mobile-bar">
        <strong className="brand">{businessName ?? 'Visitor BSM'}</strong>
        <button type="button" aria-expanded={open} aria-controls="side-menu" onClick={() => setOpen(!open)}>
          Menu
        </button>
      </div>

      <aside id="side-menu" className={`sidebar ${open ? 'sidebar-open' : ''}`}>
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">
            {initials(businessName ?? 'Visitor BSM')}
          </span>
          <div>
            <strong className="brand">{businessName ?? 'Visitor BSM'}</strong>
            <span className="muted small">Visitor management</span>
          </div>
        </div>
        {profile.data && <PremisesSwitcher profile={profile.data} />}
        <nav aria-label="Main">
          {can('desk') && has('dashboard') && (
            <MenuGroup title="Gate desk">
              {role !== 'guard' && <MenuLink to="/dashboard" label="Dashboard" onPick={close} />}
              <MenuLink to="/desk/pending" label="Awaiting approval" count={approvals} urgent={!!data?.needsCall.length} onPick={close} />
              <MenuLink to="/desk/expected" label="Expected" count={data?.expected.length} onPick={close} />
              <MenuLink to="/desk/inside" label="Inside" count={data?.inside.length} onPick={close} />
            </MenuGroup>
          )}
          {can('visitors') && (
            <MenuGroup title="My visitors">
              <MenuLink to="/my" end label="Visitor list" onPick={close} />
              {role !== 'security' && has('invites') && <MenuLink to="/my/invite" label="New invite" onPick={close} />}
              <MenuLink to="/my/backup" label="Backup person" onPick={close} />
            </MenuGroup>
          )}
          {(can('users') || can('premises') || can('departments') || can('devices')) && (
            <MenuGroup title="Admin">
              {can('users') && <MenuLink to="/admin/users" label="Users" onPick={close} />}
              {can('premises') && <MenuLink to="/admin/premises" label="Premises & gates" onPick={close} />}
              {can('departments') && <MenuLink to="/admin/departments" label="Departments" onPick={close} />}
              {can('departments') && <MenuLink to="/admin/designations" label="Designations" onPick={close} />}
              {can('devices') && <MenuLink to="/admin/devices" label="Devices" onPick={close} />}
            </MenuGroup>
          )}
        </nav>
        <div className="sidebar-user">
          <span className="avatar" aria-hidden="true">
            {initials(user?.name)}
          </span>
          <div className="sidebar-user-name">
            <span>{user?.name}</span>
            <span className="muted small">{ROLE_LABEL[role] ?? role}</span>
          </div>
          <div className="sidebar-user-links">
            <NavLink to="/account/password" onClick={close} className="link">
              Password
            </NavLink>
            <button type="button" className="link" onClick={() => void logout()}>
              Log out
            </button>
          </div>
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>

      {/* Phones: the main pages one tap away, in a round bar at the bottom. */}
      <nav aria-label="Quick menu" className="bottom-bar">
        {can('desk') && has('dashboard') && role !== 'guard' && (
          <BottomLink to="/dashboard" label="Home" icon="home" onPick={close} />
        )}
        {can('desk') && has('dashboard') && (
          <BottomLink to="/desk" label="Gate desk" icon="gate" count={approvals} onPick={close} />
        )}
        {can('visitors') && <BottomLink to="/my" label="My visitors" icon="people" onPick={close} />}
        <button
          type="button"
          className="bottom-item"
          aria-label="More"
          aria-expanded={open}
          aria-controls="side-menu"
          onClick={() => {
            setOpen(!open);
            // The full menu opens at the top of the page.
            document.scrollingElement?.scrollTo?.({ top: 0 });
          }}
        >
          <BottomIcon name="more" />
        </button>
      </nav>
    </div>
  );
}

export function Layout() {
  const { user, premisesId } = useAuth();
  // A premises change also needs a new live connection for that premises.
  return user && DESK_ROLES.includes(user.role) ? (
    <LiveSiteProvider key={premisesId ?? 'default'}>
      <Shell />
    </LiveSiteProvider>
  ) : (
    <Shell />
  );
}
