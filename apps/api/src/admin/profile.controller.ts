import { Body, Controller, Get, Inject, Patch, Query } from '@nestjs/common';
import { z } from 'zod';
import { AllowSuperAdmin } from '../auth/permissions';
import { AuthUser, CurrentUser, Roles } from '../auth/roles.decorator';
import { ApiException } from '../common/api-exception';
import { parseBody } from '../common/parse';
import { PrismaService } from '../prisma/prisma.service';
import { TENANT_PRISMA, TenantPrismaClient } from '../tenancy/tenant-prisma';
import { USER_FIELDS } from './users.controller';

const meUpdate = z.object({ delegateId: z.string().uuid().nullable() });

@Controller()
export class ProfileController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
  ) {}

  /** Raw client: a super admin (no business) can also read their profile. Everything is keyed by user.id. */
  private async profile(user: AuthUser) {
    const { delegate, premises, business, ...me } = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        ...USER_FIELDS,
        delegateId: true,
        delegate: { select: { name: true } },
        business: { select: { id: true, name: true, slug: true } },
      },
    });
    const premisesList = await this.prisma.premises.findMany({
      where: { id: { in: user.premisesIds } },
      select: { id: true, name: true, isDefault: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return {
      ...me,
      premisesIds: premises.map((p) => p.premisesId),
      delegateName: delegate?.name ?? null,
      business,
      premises: premisesList,
      activePremisesId: user.premisesId,
      features: user.features,
      // What this person may open (role + admin ticks), not the raw ticks.
      modules: user.modules,
    };
  }

  @AllowSuperAdmin()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.profile(user);
  }

  @Patch('me')
  async updateMe(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { delegateId } = parseBody(meUpdate, body);
    if (delegateId) {
      const delegate = await this.db.user.findFirst({
        where: { id: delegateId, isActive: true, premises: { some: { premisesId: { in: user.premisesIds } } } },
      });
      if (delegateId === user.id || !delegate) {
        throw new ApiException(422, 'VALIDATION_FAILED', 'The backup person must be an active employee at your premises.');
      }
    }
    await this.db.user.update({ where: { id: user.id }, data: { delegateId } });
    return this.profile(user);
  }

  @Get('gates')
  gates(@CurrentUser() user: AuthUser) {
    return this.db.gate.findMany({
      where: { premisesId: user.premisesId ?? '', isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, premisesId: true },
    });
  }

  @Roles('guard', 'reception', 'employee', 'security', 'admin')
  @Get('users/hosts')
  async hosts(@CurrentUser() user: AuthUser, @Query('q') q = '') {
    const rows = await this.db.user.findMany({
      where: {
        isActive: true,
        isHost: true,
        name: { contains: q, mode: 'insensitive' },
        role: { in: ['employee', 'reception', 'security', 'admin'] },
        premises: { some: { premisesId: user.premisesId ?? '' } },
      },
      select: { id: true, name: true, department: { select: { name: true } } },
      orderBy: { name: 'asc' },
      take: 20,
    });
    return rows.map((r) => ({ id: r.id, name: r.name, department: r.department?.name ?? null }));
  }
}
