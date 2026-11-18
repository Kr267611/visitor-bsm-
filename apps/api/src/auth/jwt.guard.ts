import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ApiException } from '../common/api-exception';
import { PrismaService } from '../prisma/prisma.service';
import { fillContext } from '../tenancy/request-context';
import { AuthUser, PUBLIC_KEY } from './roles.decorator';

/** Access token se user nikalta hai. HTTP aur live connection dono yahi use karte hain. */
@Injectable()
export class SessionResolver {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async resolve(token: string): Promise<AuthUser | null> {
    let payload: { sub: string; deviceId: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      return null;
    }
    // Device revoke hote hi access band ho, 15 minute ka intezaar nahi.
    const device = await this.prisma.device.findUnique({
      where: { id: payload.deviceId },
      include: {
        user: {
          include: {
            business: { select: { isActive: true } },
            premises: { select: { premisesId: true, premises: { select: { isDefault: true } } } },
          },
        },
      },
    });
    if (!device || device.revokedAt || !device.user.isActive || device.userId !== payload.sub) return null;
    const user = device.user;
    // Business band ho to uske log bhi andar nahi aa sakte.
    if (user.businessId && !user.business?.isActive) return null;

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
    };
  }
}

/** Default: har route par login zaroori, jab tak @Public na ho. */
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
    if (!user) throw new ApiException(401, 'UNAUTHORIZED', 'Dobara login karein.');
    req.user = user;
    // Is request ke scoped database queries ab sirf isi business tak.
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
