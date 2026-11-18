import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles } from '../auth/roles.decorator';
import { ApiException } from '../common/api-exception';
import { parseBody, requirePhone } from '../common/parse';
import { friendly, kioskCode, notFound, slugify } from '../common/records';
import { AllowSuperAdmin } from '../auth/permissions';
import { PlanLimits } from '../plans/plan-limits.service';
import { PrismaService } from '../prisma/prisma.service';
import { TENANT_PRISMA, TenantPrismaClient } from '../tenancy/tenant-prisma';

const roleSchema = z.enum(['guard', 'employee', 'reception', 'security', 'admin']);
const uuid = z.string().uuid();

const premisesCreate = z.object({
  name: z.string().trim().min(1),
  address: z.string().optional(),
  mobile: z.string().optional(),
  email: z.string().email().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  geofenceM: z.number().int().positive().optional(),
  category: z.enum(['business', 'events', 'exhibition']).optional(),
  isDefault: z.boolean().optional(),
});
const premisesUpdate = premisesCreate.partial();
const gateCreate = z.object({ premisesId: uuid, name: z.string().min(1) });
const gateUpdate = z.object({ name: z.string().min(1), isActive: z.boolean() }).partial();
const departmentCreate = z.object({ name: z.string().trim().min(1).max(100) });
const userCreate = z.object({
  name: z.string().min(1),
  phone: z.string(),
  role: roleSchema,
  premisesIds: z.array(uuid).min(1),
  email: z.string().email().optional(),
  departmentId: uuid.optional(),
  designation: z.string().optional(),
  isHost: z.boolean().optional(),
});
const userUpdate = z
  .object({
    name: z.string().min(1),
    role: roleSchema,
    premisesIds: z.array(uuid).min(1),
    email: z.string().email().nullable(),
    departmentId: uuid.nullable(),
    designation: z.string().nullable(),
    isHost: z.boolean(),
    isActive: z.boolean(),
  })
  .partial();

export const USER_FIELDS = {
  id: true,
  name: true,
  phone: true,
  email: true,
  role: true,
  departmentId: true,
  designation: true,
  isHost: true,
  isActive: true,
  premises: { select: { premisesId: true } },
} as const;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_FIELDS }>;
const toUser = ({ premises, ...u }: UserRow) => ({ ...u, premisesIds: premises.map((p) => p.premisesId) });

@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: PlanLimits,
  ) {}

  private businessOf(user: AuthUser): string {
    if (!user.businessId) throw new ApiException(403, 'FORBIDDEN', 'Aapko iski permission nahi hai.');
    return user.businessId;
  }

  /** Diye gaye premises sab isi business ke hon. */
  private async assertPremises(businessId: string, ids: string[]) {
    const found = await this.prisma.premises.count({ where: { businessId, id: { in: ids } } });
    if (found !== new Set(ids).size) throw new ApiException(422, 'VALIDATION_FAILED', 'Chuna gaya premises nahi mila.');
  }

  private async assertDepartment(businessId: string, id: string | null | undefined) {
    if (!id) return;
    if (!(await this.prisma.department.count({ where: { businessId, id } }))) {
      throw new ApiException(422, 'VALIDATION_FAILED', 'Chuna gaya department nahi mila.');
    }
  }

  @Get('premises')
  premises(@CurrentUser() user: AuthUser) {
    return this.prisma.premises.findMany({
      where: { businessId: this.businessOf(user) },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  @Post('premises')
  async createPremises(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const businessId = this.businessOf(user);
    const data = parseBody(premisesCreate, body);
    await this.limits.assert(businessId, 'premises');
    const taken = await this.prisma.premises.count({ where: { businessId, webSlug: { startsWith: slugify(data.name) } } });
    const webSlug = taken ? `${slugify(data.name)}-${taken + 1}` : slugify(data.name);
    const isFirst = !(await this.prisma.premises.count({ where: { businessId } }));
    return friendly(
      this.prisma.$transaction(async (tx) => {
        if (data.isDefault) await tx.premises.updateMany({ where: { businessId }, data: { isDefault: false } });
        const premises = await tx.premises.create({
          data: { ...data, businessId, code: kioskCode(), webSlug, isDefault: data.isDefault ?? isFirst },
        });
        await tx.premisesSetting.create({ data: { premisesId: premises.id, businessId } });
        return premises;
      }),
    );
  }

  @Patch('premises/:id')
  async updatePremises(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const businessId = this.businessOf(user);
    const data = parseBody(premisesUpdate, body);
    if (!(await this.prisma.premises.count({ where: { id, businessId } }))) throw notFound();
    return this.prisma.$transaction(async (tx) => {
      if (data.isDefault) await tx.premises.updateMany({ where: { businessId }, data: { isDefault: false } });
      return tx.premises.update({ where: { id }, data });
    });
  }

  @Get('gates')
  gates(@CurrentUser() user: AuthUser) {
    return this.prisma.gate.findMany({ where: { businessId: this.businessOf(user) }, orderBy: { name: 'asc' } });
  }

  @Post('gates')
  async createGate(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const businessId = this.businessOf(user);
    const data = parseBody(gateCreate, body);
    await this.assertPremises(businessId, [data.premisesId]);
    return this.prisma.gate.create({ data: { ...data, businessId } });
  }

  @Patch('gates/:id')
  async updateGate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const businessId = this.businessOf(user);
    if (!(await this.prisma.gate.count({ where: { id, businessId } }))) throw notFound();
    return this.prisma.gate.update({ where: { id }, data: parseBody(gateUpdate, body) });
  }

  @Get('departments')
  departments(@CurrentUser() user: AuthUser) {
    return this.prisma.department.findMany({ where: { businessId: this.businessOf(user) }, orderBy: { name: 'asc' } });
  }

  @Post('departments')
  createDepartment(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const businessId = this.businessOf(user);
    return friendly(this.prisma.department.create({ data: { ...parseBody(departmentCreate, body), businessId } }));
  }

  @Get('users')
  async users(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.user.findMany({
      where: { businessId: this.businessOf(user) },
      select: USER_FIELDS,
      orderBy: { name: 'asc' },
    });
    return rows.map(toUser);
  }

  @Post('users')
  async createUser(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const businessId = this.businessOf(user);
    const { premisesIds, ...data } = parseBody(userCreate, body);
    await this.assertPremises(businessId, premisesIds);
    await this.assertDepartment(businessId, data.departmentId);
    await this.limits.assert(businessId, 'members');
    const created = await friendly(
      this.prisma.user.create({
        data: {
          ...data,
          businessId,
          phone: requirePhone(data.phone),
          premises: { create: premisesIds.map((premisesId) => ({ premisesId, businessId })) },
        },
        select: USER_FIELDS,
      }),
    );
    return toUser(created);
  }

  @Patch('users/:id')
  async updateUser(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const businessId = this.businessOf(user);
    const { premisesIds, ...data } = parseBody(userUpdate, body);
    const current = await this.prisma.user.findFirst({ where: { id, businessId }, select: { isActive: true } });
    if (!current) throw notFound();
    // Band member ko wapas chalu karna bhi member limit mein ginta hai.
    if (data.isActive && !current.isActive) await this.limits.assert(businessId, 'members');
    if (premisesIds) await this.assertPremises(businessId, premisesIds);
    await this.assertDepartment(businessId, data.departmentId);
    const updated = await friendly(
      this.prisma.user.update({
        where: { id },
        data: {
          ...data,
          ...(premisesIds && {
            premises: { deleteMany: {}, create: premisesIds.map((premisesId) => ({ premisesId, businessId })) },
          }),
        },
        select: USER_FIELDS,
      }),
    );
    return toUser(updated);
  }
}

const meUpdate = z.object({ delegateId: uuid.nullable() });

@Controller()
export class ProfileController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
  ) {}

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
      const delegate = await this.prisma.user.findFirst({
        where: {
          id: delegateId,
          businessId: user.businessId ?? undefined,
          isActive: true,
          premises: { some: { premisesId: { in: user.premisesIds } } },
        },
      });
      if (delegateId === user.id || !delegate) {
        throw new ApiException(422, 'VALIDATION_FAILED', 'Backup person apne premises ka active employee hona chahiye.');
      }
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { delegateId } });
    return this.profile(user);
  }

  @Get('gates')
  gates(@CurrentUser() user: AuthUser) {
    // Scoped client: business filter khud lagta hai.
    return this.db.gate.findMany({
      where: { premisesId: user.premisesId ?? '', isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, premisesId: true },
    });
  }

  @Roles('guard', 'reception', 'employee', 'security', 'admin')
  @Get('users/hosts')
  async hosts(@CurrentUser() user: AuthUser, @Query('q') q = '') {
    const rows = await this.prisma.user.findMany({
      where: {
        businessId: user.businessId ?? '',
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
