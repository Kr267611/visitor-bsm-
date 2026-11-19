import type { Role } from './types';

/**
 * Screens an admin can switch on or off for each member ("module access").
 * The role sets the most a member can have; the admin's ticks choose within that.
 */
export const MODULES = ['desk', 'visitors', 'users', 'premises', 'departments', 'devices'] as const;
export type Module = (typeof MODULES)[number];

export const MODULE_LABEL: Record<Module, string> = {
  desk: 'Gate desk',
  visitors: 'My visitors',
  users: 'Users',
  premises: 'Premises & gates',
  departments: 'Departments & designations',
  devices: 'Devices',
};

/** Everything a role may be given. A new member starts with all of it ticked. */
export const ROLE_MODULES: Record<Role, readonly Module[]> = {
  super_admin: [],
  admin: MODULES,
  security: ['desk', 'visitors', 'devices'],
  reception: ['desk', 'visitors'],
  guard: ['desk'],
  employee: ['visitors'],
};

/**
 * What the member can actually open: the role's modules, narrowed by the admin's ticks.
 * No ticks saved (empty list) means "everything the role allows"; to take all access away, deactivate the member.
 */
export function effectiveModules(role: Role, chosen: readonly string[] | null | undefined): Module[] {
  const allowed = ROLE_MODULES[role] ?? [];
  return chosen?.length ? allowed.filter((m) => chosen.includes(m)) : [...allowed];
}
