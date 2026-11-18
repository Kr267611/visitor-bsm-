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
  /** Super admin ke liye null. */
  businessId: string | null;
  /** Abhi chuna hua premises. */
  premisesId: string | null;
  /** Jin premises ka access hai (admin: business ke saare). */
  premisesIds: string[];
  deviceId: string;
  /** Business ke plan ke modules (super admin: khaali). */
  features: string[];
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
