import { ReactNode } from 'react';

/** Har page ka upar wala hissa: naam, ek line ka matlab, aur main kaam ka button. */
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

/** Khaali list: kya hua aur aage kya karein. */
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

/** Naam ke pehle akshar (avatar ke liye). */
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
