import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ApiException } from '../common/api-exception';
import { PrismaService } from '../prisma/prisma.service';
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
      include: { user: true },
    });
    if (!device || device.revokedAt || !device.user.isActive || device.userId !== payload.sub) return null;
    return {
      id: device.user.id,
      role: device.user.role,
      siteId: device.user.siteId,
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
    return true;
  }
}
