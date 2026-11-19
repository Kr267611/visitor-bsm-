import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { effectiveModules, MODULES } from '@visitor/shared';
import { z } from 'zod';
import { hashPassword, PASSWORD_MAX, PASSWORD_MIN } from '../auth/password';
import { RequireFeature, RequireModule } from '../auth/permissions';
import { AuthUser, CurrentUser, Roles } from '../auth/roles.decorator';
import { audit } from '../audit/audit.service';
import { ApiException } from '../common/api-exception';
import { parseBody, requirePhone } from '../common/parse';
import { friendly, notFound } from '../common/records';
import { PlanLimits } from '../plans/plan-limits.service';
import { tenantId } from '../tenancy/request-context';
import { TENANT_PRISMA, TenantPrismaClient } from '../tenancy/tenant-prisma';
import { cleanRows, importBody } from './users-import';

const roleSchema = z.enum(['guard', 'employee', 'reception', 'security', 'admin']);
const uuid = z.string().uuid();
const password = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX);
/** Ticked modules; an empty list means everything the role allows. */
const modules = z.array(z.enum(MODULES)).max(MODULES.length);

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
  modules: modules.optional(),
  password,
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
    modules,
  })
  .partial();

/** passwordHash is never selected: not in responses, not in the audit log. */
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
  modules: true,
  lastLoginAt: true,
  premises: { select: { premisesId: true } },
} as const;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_FIELDS }>;
export const toUser = ({ premises, ...u }: UserRow) => ({ ...u, premisesIds: premises.map((p) => p.premisesId) });

@Roles('admin')
@RequireModule('users')
@Controller('admin')
export class UsersController {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly limits: PlanLimits,
  ) {}

  /** All given premises must belong to this business. */
  private async assertPremises(ids: string[]) {
    const found = await this.db.premises.count({ where: { id: { in: ids } } });
    if (found !== new Set(ids).size) throw new ApiException(422, 'VALIDATION_FAILED', 'The selected premises was not found.');
  }

  private async assertDepartment(id: string | null | undefined) {
    if (id && !(await this.db.department.count({ where: { id } }))) {
      throw new ApiException(422, 'VALIDATION_FAILED', 'The selected department was not found.');
    }
  }

  /** An admin can never lock themselves out: there is always at least one person who can manage users. */
  private assertKeepsOwnAccess(change: { isActive?: boolean; role?: string; modules?: string[] }) {
    const refuse = (message: string) => new ApiException(422, 'VALIDATION_FAILED', message);
    if (change.isActive === false) throw refuse('You cannot deactivate your own account.');
    if (change.role && change.role !== 'admin') throw refuse('You cannot change your own role.');
    if (change.modules && !effectiveModules('admin', change.modules).includes('users')) {
      throw refuse('You cannot remove your own access to Users.');
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
  async update(@CurrentUser() me: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const businessId = tenantId();
    const { premisesIds, ...data } = parseBody(userUpdate, body);
    const before = await this.userOrThrow(id);
    if (id === me.id) this.assertKeepsOwnAccess(data);
    if (premisesIds) await this.assertPremises(premisesIds);
    await this.assertDepartment(data.departmentId);
    // Turning an inactive member back on also counts against the member limit.
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

  /**
   * Bulk upload from a spreadsheet. All or nothing: if any row has a problem, nothing is saved and every
   * problem comes back with its line number. Missing departments and designations are created on the way.
   */
  @RequireFeature('bulk_import')
  @Post('users/import')
  @HttpCode(200)
  async import(@Body() body: unknown) {
    const businessId = tenantId();
    const { clean, problems } = cleanRows(parseBody(importBody, body).rows);

    const premises = await this.db.premises.findMany({ select: { id: true, name: true, isDefault: true } });
    const defaultPremises = premises.find((p) => p.isDefault) ?? premises[0];
    const premisesByName = new Map(premises.map((p) => [p.name.toLowerCase(), p.id]));
    const taken = await this.db.user.findMany({
      where: { OR: [{ phone: { in: clean.map((r) => r.phone) } }, { email: { in: clean.flatMap((r) => r.email ?? []) } }] },
      select: { phone: true, email: true },
    });
    const takenPhones = new Set(taken.map((u) => u.phone));
    const takenEmails = new Set(taken.flatMap((u) => u.email?.toLowerCase() ?? []));
    const rows = clean.flatMap((row) => {
      const errors: string[] = [];
      if (takenPhones.has(row.phone)) errors.push('A user with this mobile already exists.');
      if (row.email && takenEmails.has(row.email)) errors.push('A user with this email already exists.');
      const premisesId = row.premises ? premisesByName.get(row.premises.toLowerCase()) : defaultPremises?.id;
      if (!premisesId) errors.push(`Premises "${row.premises}" was not found.`);
      if (errors.length) {
        problems.push({ line: row.line, errors });
        return [];
      }
      return [{ ...row, premisesId: premisesId! }];
    });
    if (problems.length) {
      problems.sort((a, b) => a.line - b.line);
      throw new ApiException(422, 'VALIDATION_FAILED', `${problems.length} row(s) need fixing. Nothing was saved.`, {
        rows: problems,
      });
    }

    await this.limits.assert(businessId, 'members', rows.length);
    const hashes = await Promise.all(rows.map((r) => hashPassword(r.password)));

    return this.db.$transaction(
      async (tx) => {
        // Departments and designations by name, case-insensitive; create the ones that do not exist yet.
        const departments = await tx.department.findMany({ include: { designations: true } });
        const deptIds = new Map(departments.map((d) => [d.name.toLowerCase(), d.id]));
        const designationKeys = new Set(
          departments.flatMap((d) => d.designations.map((x) => `${d.id}|${x.name.toLowerCase()}`)),
        );
        const designationName = new Map<string, string>(
          departments.flatMap((d) => d.designations.map((x) => [`${d.id}|${x.name.toLowerCase()}`, x.name] as const)),
        );
        let departmentsCreated = 0;
        let designationsCreated = 0;
        for (const row of rows) {
          if (!row.department) continue;
          let deptId = deptIds.get(row.department.toLowerCase());
          if (!deptId) {
            const dept = await tx.department.create({ data: { name: row.department, businessId } });
            await audit(tx, { entity: 'department', entityId: dept.id, action: 'create', after: dept });
            deptIds.set(row.department.toLowerCase(), dept.id);
            deptId = dept.id;
            departmentsCreated++;
          }
          if (row.designation) {
            const key = `${deptId}|${row.designation.toLowerCase()}`;
            if (!designationKeys.has(key)) {
              const des = await tx.designation.create({ data: { name: row.designation, departmentId: deptId, businessId } });
              await audit(tx, { entity: 'designation', entityId: des.id, action: 'create', after: des });
              designationKeys.add(key);
              designationName.set(key, des.name);
              designationsCreated++;
            }
          }
        }

        for (const [i, row] of rows.entries()) {
          const departmentId = row.department ? deptIds.get(row.department.toLowerCase())! : null;
          const created = toUser(
            await tx.user.create({
              data: {
                businessId,
                name: row.name,
                phone: row.phone,
                email: row.email,
                role: row.role,
                departmentId,
                // Same spelling as the designation list, even if the sheet used other capitals.
                designation: row.designation
                  ? (designationName.get(`${departmentId}|${row.designation.toLowerCase()}`) ?? row.designation)
                  : null,
                isHost: row.isHost,
                passwordHash: hashes[i],
                premises: { create: { premisesId: row.premisesId, businessId } },
              },
              select: USER_FIELDS,
            }),
          );
          await audit(tx, { entity: 'user', entityId: created.id, action: 'import', after: created });
        }
        return { created: rows.length, departmentsCreated, designationsCreated };
      },
      { timeout: 60_000 },
    );
  }

  /** Admin sets a new password; the member is signed out of all devices. */
  @Put('users/:id/password')
  @HttpCode(204)
  async resetPassword(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { password: plain } = parseBody(z.object({ password }), body);
    await this.userOrThrow(id);
    const passwordHash = await hashPassword(plain);
    const now = new Date();
    await this.db.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash } });
      // Devices and refresh tokens are not tenant tables; the user was checked above.
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
