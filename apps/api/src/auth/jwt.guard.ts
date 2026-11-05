import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ApiException } from '../common/api-exception';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLIC_KEY } from './roles.decorator';

const unauthorized = () => new ApiException(401, 'UNAUTHORIZED', 'Dobara login karein.');

/** Default: har route par login zaroori, jab tak @Public na ho. */
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();

    let payload: { sub: string; deviceId: string };
    try {
      payload = await this.jwt.verifyAsync(header.slice(7));
    } catch {
      throw unauthorized();
    }

    // Device revoke hote hi access band ho, 15 minute ka intezaar nahi.
    const device = await this.prisma.device.findUnique({
      where: { id: payload.deviceId },
      include: { user: true },
    });
    if (!device || device.revokedAt || !device.user.isActive || device.userId !== payload.sub) {
      throw unauthorized();
    }

    req.user = {
      id: device.user.id,
      role: device.user.role,
      siteId: device.user.siteId,
      deviceId: device.id,
    };
    return true;
  }
}
