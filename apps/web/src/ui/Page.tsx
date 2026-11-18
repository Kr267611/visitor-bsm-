import { ReactNode } from 'react';

/** Page header: title, one-line explanation, and the main action. */
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="row page-head-actions">{actions}</div>}
    </header>
  );
}

/** Empty list: what happened and what to do next. */
export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-mark" aria-hidden="true" />
      <p className="empty-title">{title}</p>
      {hint && <p className="muted">{hint}</p>}
      {action}
    </div>
  );
}

/** Initials of a name (for avatars). */
export function initials(name: string | undefined | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

export const ROLE_LABEL: Record<string, string> = {
  guard: 'Guard',
  employee: 'Employee',
  reception: 'Reception',
  security: 'Security',
  admin: 'Admin',
  super_admin: 'Platform admin',
};
