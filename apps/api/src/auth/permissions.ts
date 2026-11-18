import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException } from '../common/api-exception';
import { AuthUser } from './roles.decorator';

/** Plan ke modules. Plan.features mein inhi ke code hote hain. */
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

/** Yeh route tabhi khulega jab business ke plan mein yeh module ho. */
export const RequireFeature = (feature: Feature) => SetMetadata(FEATURE_KEY, feature);

/** Super admin ka koi business nahi; sirf in routes (jaise /me) par aa sakta hai. */
export const AllowSuperAdmin = () => SetMetadata(SUPER_ADMIN_OK_KEY, true);

export const FEATURE_RESTRICTED_MESSAGE = 'Access Restricted: yeh module aapke plan mein nahi hai.';

/** Permission = role (RolesGuard) ∩ plan ke features (yeh guard). */
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
