import type { Role } from '@visitor/shared';
import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (!roles.includes(user.role)) {
    return <p className="page-message">Is page ki permission aapko nahi hai.</p>;
  }
  return <>{children}</>;
}

export const homeFor = (role: Role): string => {
  if (role === 'employee') return '/my';
  if (role === 'admin') return '/admin/members';
  if (role === 'super_admin') return '/platform';
  return '/desk';
};
