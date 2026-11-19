import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Module, Role } from '@visitor/shared';

export const ROLES_KEY = 'roles';
export const PUBLIC_KEY = 'public';

/** Only these roles may access the route. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Route that works without sign-in. Every other route requires it. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export interface AuthUser {
  id: string;
  role: Role;
  /** null for a super admin. */
  businessId: string | null;
  /** Currently selected premises. */
  premisesId: string | null;
  /** Premises the user can access (admin: every premises of the business). */
  premisesIds: string[];
  deviceId: string;
  /** Modules in the business plan (empty for a super admin). */
  features: string[];
  /** Screens this member may open: role, narrowed by the admin's ticks. */
  modules: Module[];
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
