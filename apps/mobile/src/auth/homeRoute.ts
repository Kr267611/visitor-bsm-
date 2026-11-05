import type { Role } from '@visitor/shared';

export function homeRouteFor(role: Role): '/(guard)' | '/(host)' | '/use-web' {
  if (role === 'guard' || role === 'reception') return '/(guard)';
  if (role === 'employee') return '/(host)';
  return '/use-web';
}
