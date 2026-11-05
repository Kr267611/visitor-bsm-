import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@visitor/shared';

export const ROLES_KEY = 'roles';
export const PUBLIC_KEY = 'public';

/** Sirf in roles ko access. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Login ke bina khulne wala route. Baaki sab par login zaroori hai. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export interface AuthUser {
  id: string;
  role: Role;
  siteId: string | null;
  deviceId: string;
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
