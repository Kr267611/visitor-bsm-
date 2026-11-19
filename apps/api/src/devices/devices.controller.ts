import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { RequireModule } from '../auth/permissions';
import { AuthUser, CurrentUser, Roles } from '../auth/roles.decorator';
import { ApiException } from '../common/api-exception';
import { parseBody } from '../common/parse';
import { PrismaService } from '../prisma/prisma.service';

const pushTokenSchema = z.object({ pushToken: z.string().min(1).max(300) });

@Controller()
export class DevicesController {
  constructor(private readonly prisma: PrismaService) {}

  /** Admins see every device in the business; security sees only people at their premises. */
  private scope(user: AuthUser) {
    const businessId = user.businessId ?? '';
    return user.role === 'admin'
      ? { user: { businessId } }
      : { user: { businessId, premises: { some: { premisesId: { in: user.premisesIds } } } } };
  }

  @Post('devices/push-token')
  @HttpCode(204)
  async savePushToken(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { pushToken } = parseBody(pushTokenSchema, body);
    // A phone's push token belongs to its latest sign-in only; otherwise another user's pushes would arrive here.
    await this.prisma.device.updateMany({
      where: { pushToken, id: { not: user.deviceId } },
      data: { pushToken: null },
    });
    await this.prisma.device.update({
      where: { id: user.deviceId },
      data: { pushToken, lastSeenAt: new Date() },
    });
  }

  @Roles('admin', 'security')
  @RequireModule('devices')
  @Get('admin/devices')
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.device.findMany({
      where: this.scope(user),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        lastSeenAt: true,
        revokedAt: true,
        createdAt: true,
        user: { select: { id: true, name: true, role: true } },
      },
    });
  }

  @Roles('admin', 'security')
  @RequireModule('devices')
  @Post('admin/devices/:id/revoke')
  @HttpCode(204)
  async revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const exists = await this.prisma.device.count({ where: { id, ...this.scope(user) } });
    if (!exists) throw new ApiException(404, 'NOT_FOUND', 'Device not found.');
    await this.prisma.device.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), pushToken: null },
    });
    await this.prisma.refreshToken.updateMany({
      where: { deviceId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
