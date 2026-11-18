import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@visitor/shared';
import { ApiException } from '../common/api-exception';
import { SUPER_ADMIN_OK_KEY } from './permissions';
import { PUBLIC_KEY, ROLES_KEY } from './roles.decorator';

const forbidden = () => new ApiException(403, 'FORBIDDEN', 'You do not have permission to do this.');

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, targets);
    const { user } = context.switchToHttp().getRequest();

    // A super admin belongs to no business: tenant routes are closed, only platform routes and explicitly allowed ones are open.
    if (user?.role === 'super_admin') {
      if (roles?.includes('super_admin') || this.reflector.getAllAndOverride<boolean>(SUPER_ADMIN_OK_KEY, targets)) {
        return true;
      }
      throw forbidden();
    }
    if (!roles?.length) return true;
    if (!user || !roles.includes(user.role)) throw forbidden();
    return true;
  }
}
