import { ROLE_MODULES, type Module, type Role } from '@visitor/shared';
import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useProfile } from '../ui/Layout';
import { useAuth } from './AuthProvider';

/** Screens this person may open: from the profile, or from the role until the profile has loaded. */
export function useModules(): { modules: Module[]; ready: boolean } {
  const { user } = useAuth();
  const profile = useProfile();
  const fromProfile = profile.data?.modules;
  if (Array.isArray(fromProfile)) return { modules: fromProfile, ready: true };
  // An older server without module access: fall back to the role. The server still enforces its own rules.
  const fallback = user ? [...(ROLE_MODULES[user.role as Role] ?? [])] : [];
  return { modules: fallback, ready: !profile.isLoading };
}

const PAGE: Record<Module, string> = {
  desk: '/desk',
  visitors: '/my',
  users: '/admin/users',
  premises: '/admin/premises',
  departments: '/admin/departments',
  devices: '/admin/devices',
};

/** First page this person can open. Admins start on the dashboard, or on Users without the desk. */
export function homeForModules(role: Role, modules: Module[]): string {
  if (role === 'super_admin') return '/platform';
  if (role === 'admin' && modules.includes('desk')) return '/dashboard';
  if (role === 'admin' && modules.includes('users')) return PAGE.users;
  const first = (['desk', 'visitors', 'users', 'premises', 'departments', 'devices'] as const).find((m) => modules.includes(m));
  return first ? PAGE[first] : '/account/password';
}

/** The page opens only when the admin has given this person the module. */
export function RequireModule({ module, children }: { module: Module; children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const { modules, ready } = useModules();
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (!modules.includes(module)) {
    return ready ? (
      <p className="page-message" role="alert">
        You do not have access to this page. Ask your admin.
      </p>
    ) : null;
  }
  return <>{children}</>;
}
