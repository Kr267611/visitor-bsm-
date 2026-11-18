import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { hashPassword, PASSWORD_MAX, PASSWORD_MIN } from '../auth/password';
import { Roles } from '../auth/roles.decorator';
import { audit } from '../audit/audit.service';
import { ApiException } from '../common/api-exception';
import { parseBody, requirePhone } from '../common/parse';
import { friendly, notFound } from '../common/records';
import { PlanLimits } from '../plans/plan-limits.service';
import { tenantId } from '../tenancy/request-context';
import { TENANT_PRISMA, TenantPrismaClient } from '../tenancy/tenant-prisma';

const roleSchema = z.enum(['guard', 'employee', 'reception', 'security', 'admin']);
const uuid = z.string().uuid();
const password = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX);

const userCreate = z.object({
  name: z.string().trim().min(1).max(100),
  phone: z.string(),
  role: roleSchema,
  premisesIds: z.array(uuid).min(1),
  email: z.string().email().optional(),
  departmentId: uuid.optional(),
  designation: z.string().max(100).optional(),
  joiningDate: z.coerce.date().optional(),
  isHost: z.boolean().optional(),
  password: password.optional(),
});
const userUpdate = z
  .object({
    name: z.string().trim().min(1).max(100),
    role: roleSchema,
    premisesIds: z.array(uuid).min(1),
    email: z.string().email().nullable(),
    departmentId: uuid.nullable(),
    designation: z.string().max(100).nullable(),
    joiningDate: z.coerce.date().nullable(),
    isHost: z.boolean(),
    isActive: z.boolean(),
  })
  .partial();

/** passwordHash kabhi select nahi hota: na jawab mein, na audit mein. */
export const USER_FIELDS = {
  id: true,
  name: true,
  phone: true,
  email: true,
  role: true,
  departmentId: true,
  designation: true,
  joiningDate: true,
  isHost: true,
  isActive: true,
  premises: { select: { premisesId: true } },
} as const;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_FIELDS }>;
export const toUser = ({ premises, ...u }: UserRow) => ({ ...u, premisesIds: premises.map((p) => p.premisesId) });

@Roles('admin')
@Controller('admin')
export class UsersController {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly limits: PlanLimits,
  ) {}

  /** Diye gaye premises sab isi business ke hon. */
  private async assertPremises(ids: string[]) {
    const found = await this.db.premises.count({ where: { id: { in: ids } } });
    if (found !== new Set(ids).size) throw new ApiException(422, 'VALIDATION_FAILED', 'Chuna gaya premises nahi mila.');
  }

  private async assertDepartment(id: string | null | undefined) {
    if (id && !(await this.db.department.count({ where: { id } }))) {
      throw new ApiException(422, 'VALIDATION_FAILED', 'Chuna gaya department nahi mila.');
    }
  }

  private async userOrThrow(id: string) {
    const row = await this.db.user.findUnique({ where: { id }, select: USER_FIELDS });
    if (!row) throw notFound();
    return toUser(row);
  }

  @Get('users')
  async list(@Query('q') q = '') {
    const rows = await this.db.user.findMany({
      where: q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] } : {},
      select: USER_FIELDS,
      orderBy: { name: 'asc' },
    });
    return rows.map(toUser);
  }

  @Post('users')
  async create(@Body() body: unknown) {
    const businessId = tenantId();
    const { premisesIds, password: plain, ...data } = parseBody(userCreate, body);
    const phone = requirePhone(data.phone);
    await this.assertPremises(premisesIds);
    await this.assertDepartment(data.departmentId);
    await this.limits.assert(businessId, 'members');
    const passwordHash = plain ? await hashPassword(plain) : null;
    return friendly(
      this.db.$transaction(async (tx) => {
        const created = toUser(
          await tx.user.create({
            data: {
              ...data,
              phone,
              businessId,
              passwordHash,
              premises: { create: premisesIds.map((premisesId) => ({ premisesId, businessId })) },
            },
            select: USER_FIELDS,
          }),
        );
        await audit(tx, { entity: 'user', entityId: created.id, action: 'create', after: created });
        return created;
      }),
    );
  }

  @Patch('users/:id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const businessId = tenantId();
    const { premisesIds, ...data } = parseBody(userUpdate, body);
    const before = await this.userOrThrow(id);
    if (premisesIds) await this.assertPremises(premisesIds);
    await this.assertDepartment(data.departmentId);
    // Band member ko wapas chalu karna bhi member limit mein ginta hai.
    if (data.isActive && !before.isActive) await this.limits.assert(businessId, 'members');
    return friendly(
      this.db.$transaction(async (tx) => {
        if (premisesIds) {
          await tx.userPremises.deleteMany({ where: { userId: id } });
          await tx.userPremises.createMany({ data: premisesIds.map((premisesId) => ({ userId: id, premisesId, businessId })) });
        }
        const after = toUser(await tx.user.update({ where: { id }, data, select: USER_FIELDS }));
        await audit(tx, { entity: 'user', entityId: id, action: 'update', before, after });
        return after;
      }),
    );
  }

  /** Admin naya password set kare: us member ke saare devices logout. */
  @Put('users/:id/password')
  @HttpCode(204)
  async resetPassword(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { password: plain } = parseBody(z.object({ password }), body);
    await this.userOrThrow(id);
    const passwordHash = await hashPassword(plain);
    const now = new Date();
    await this.db.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash } });
      // Device aur refresh token tenant tables nahi; user upar check ho chuka hai.
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now } });
      await tx.device.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now, pushToken: null } });
      await audit(tx, { entity: 'user', entityId: id, action: 'password_reset' });
    });
  }

  @Get('audit')
  auditLog(@Query('entity') entity?: string, @Query('entityId') entityId?: string) {
    return this.db.auditLog.findMany({
      where: { ...(entity && { entity }), ...(entityId && { entityId }) },
      orderBy: { at: 'desc' },
      take: 200,
    });
  }
}
