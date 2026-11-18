import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException } from '../common/api-exception';
import { AuthUser } from './roles.decorator';

/** Plan modules. Plan.features holds these codes. */
export const FEATURES = [
  'visitor_desk',
  'dashboard',
  'reports',
  'invites',
  'appointments',
  'watchlist',
  'emergency_alert',
  'kiosk',
  'bulk_import',
  'form_builder',
  'azure_ad',
] as const;
export type Feature = (typeof FEATURES)[number];

export const FEATURE_KEY = 'feature';
export const SUPER_ADMIN_OK_KEY = 'superAdminOk';

/** The route opens only when the business plan includes this module. */
export const RequireFeature = (feature: Feature) => SetMetadata(FEATURE_KEY, feature);

/** A super admin has no business; they can reach only routes marked like this (such as /me). */
export const AllowSuperAdmin = () => SetMetadata(SUPER_ADMIN_OK_KEY, true);

export const FEATURE_RESTRICTED_MESSAGE = 'Access restricted: this module is not included in your plan.';

/** Permission = role (RolesGuard) AND plan features (this guard). */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const feature = this.reflector.getAllAndOverride<Feature | undefined>(FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!feature) return true;
    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    if (!user?.features.includes(feature)) {
      throw new ApiException(403, 'FEATURE_RESTRICTED', FEATURE_RESTRICTED_MESSAGE, { feature });
    }
    return true;
  }
}
