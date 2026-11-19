import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { effectiveModules } from '@visitor/shared';
import { ApiException } from '../common/api-exception';
import { PrismaService } from '../prisma/prisma.service';
import { fillContext } from '../tenancy/request-context';
import { AuthUser, PUBLIC_KEY } from './roles.decorator';

/** Resolves the user from an access token. Used by both HTTP and the live connection. */
@Injectable()
export class SessionResolver {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async resolve(token: string): Promise<AuthUser | null> {
    let payload: { sub: string; deviceId: string; businessId?: string | null; aud?: unknown };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      return null;
    }
    // Only sign-in tokens: never a check-in session token or anything without a device.
    if (payload.aud !== undefined || typeof payload.deviceId !== 'string') return null;
    // Access stops as soon as the device is revoked, not after up to 15 minutes.
    const device = await this.prisma.device.findUnique({
      where: { id: payload.deviceId },
      include: {
        user: {
          include: {
            business: { select: { isActive: true, plan: { select: { features: true } } } },
            premises: { select: { premisesId: true, premises: { select: { isDefault: true } } } },
          },
        },
      },
    });
    if (!device || device.revokedAt || !device.user.isActive || device.userId !== payload.sub) return null;
    const user = device.user;
    // When a business is turned off, its people cannot get in either.
    if (user.businessId && !user.business?.isActive) return null;
    // The user must still belong to the business the token was issued for.
    if (payload.businessId !== undefined && payload.businessId !== user.businessId) return null;

    let premises = user.premises.map((p) => ({ id: p.premisesId, isDefault: p.premises.isDefault }));
    if (user.role === 'admin' && user.businessId) {
      premises = await this.prisma.premises.findMany({
        where: { businessId: user.businessId },
        select: { id: true, isDefault: true },
      });
    }
    const active = premises.find((p) => p.isDefault) ?? premises[0];
    return {
      id: user.id,
      role: user.role,
      businessId: user.businessId,
      premisesId: active?.id ?? null,
      premisesIds: premises.map((p) => p.id),
      deviceId: device.id,
      features: user.business?.plan.features ?? [],
      modules: effectiveModules(user.role, user.modules),
    };
  }
}

/** Default: every route needs sign-in unless marked @Public. */
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const user = header?.startsWith('Bearer ') ? await this.sessions.resolve(header.slice(7)) : null;
    if (!user) throw new ApiException(401, 'UNAUTHORIZED', 'Please sign in again.');
    // Apps send X-Premises-Id to switch premises; only the user's own premises are allowed.
    const wanted = req.headers['x-premises-id'];
    if (typeof wanted === 'string' && wanted) {
      if (!user.premisesIds.includes(wanted)) {
        throw new ApiException(403, 'PREMISES_FORBIDDEN', 'You do not have access to this premises.');
      }
      user.premisesId = wanted;
    }
    req.user = user;
    // Scoped database queries in this request now stay inside this business.
    fillContext({
      businessId: user.businessId,
      userId: user.id,
      role: user.role,
      premisesIds: user.premisesIds,
      activePremisesId: user.premisesId,
    });
    return true;
  }
}
