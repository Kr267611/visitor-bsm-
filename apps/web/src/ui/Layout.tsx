import type { Profile, Role } from '@visitor/shared';
import { useQuery } from '@tanstack/react-query';
import { ReactNode, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useApi } from '../api';
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

/** Profile (business, premises, plan ke modules). Ek hi query poore app mein. */
export function useProfile() {
  const api = useApi();
  return useQuery<Profile>({ queryKey: ['me'], queryFn: () => api.me.get() });
}

/** Plan mein module hai? Profile na mile to menu chhupate nahi; server khud 403 deta hai. */
export function useFeature() {
  const profile = useProfile();
  const features = profile.data?.features;
  return (feature: string) => !Array.isArray(features) || features.includes(feature);
}

function PremisesSwitcher({ profile }: { profile: Profile }) {
  const { premisesId, switchPremises } = useAuth();
  const list = Array.isArray(profile.premises) ? profile.premises : [];
  if (list.length < 2) return list[0] ? <span className="muted">{list[0].name}</span> : null;
  const active = premisesId ?? profile.activePremisesId ?? '';
  return (
    <div className="stack">
      <label htmlFor="premises-switch" className="muted">
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
        <strong className="brand sidebar-brand">{businessName ?? 'Visitor BSM'}</strong>
        {profile.data && <PremisesSwitcher profile={profile.data} />}
        <nav aria-label="Main">
          {DESK_ROLES.includes(role) && has('dashboard') && (
            <MenuGroup title="Gate desk">
              <MenuLink to="/desk/pending" label="Approval baaki" count={approvals} urgent={!!data?.needsCall.length} onPick={close} />
              <MenuLink to="/desk/expected" label="Aane wale" count={data?.expected.length} onPick={close} />
              <MenuLink to="/desk/inside" label="Andar hain" count={data?.inside.length} onPick={close} />
            </MenuGroup>
          )}
          {HOST_ROLES.includes(role) && (
            <MenuGroup title="Mere visitors">
              <MenuLink to="/my" end label="Visitors ki list" onPick={close} />
              {role !== 'security' && has('invites') && <MenuLink to="/my/invite" label="Naya invite" onPick={close} />}
              <MenuLink to="/my/backup" label="Backup person" onPick={close} />
            </MenuGroup>
          )}
          {(role === 'admin' || role === 'security') && (
            <MenuGroup title="Admin">
              {role === 'admin' && <MenuLink to="/admin/members" label="Members" onPick={close} />}
              {role === 'admin' && <MenuLink to="/admin/premises" label="Premises aur gates" onPick={close} />}
              {role === 'admin' && <MenuLink to="/admin/departments" label="Departments" onPick={close} />}
              <MenuLink to="/admin/devices" label="Devices" onPick={close} />
            </MenuGroup>
          )}
        </nav>
        <div className="sidebar-user">
          <span className="muted">{user?.name}</span>
          <NavLink to="/account/password" onClick={close} className="link">
            Password
          </NavLink>
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
  const { user, premisesId } = useAuth();
  // Premises badle to live connection bhi naye premises ka (naya socket).
  return user && DESK_ROLES.includes(user.role) ? (
    <LiveSiteProvider key={premisesId ?? 'default'}>
      <Shell />
    </LiveSiteProvider>
  ) : (
    <Shell />
  );
}
