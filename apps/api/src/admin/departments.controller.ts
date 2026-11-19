import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { RequireModule } from '../auth/permissions';
import { Roles } from '../auth/roles.decorator';
import { audit } from '../audit/audit.service';
import { parseBody } from '../common/parse';
import { friendly, notFound } from '../common/records';
import { tenantId } from '../tenancy/request-context';
import { TENANT_PRISMA, TenantPrismaClient } from '../tenancy/tenant-prisma';

const departmentBody = z.object({ name: z.string().trim().min(1).max(100) });
const designationBody = departmentBody;

@Roles('admin')
@RequireModule('departments')
@Controller('admin/departments')
export class DepartmentsController {
  constructor(@Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient) {}

  private async getOrThrow(id: string) {
    const row = await this.db.department.findUnique({ where: { id } });
    if (!row) throw notFound();
    return row;
  }

  @Get()
  async list() {
    const rows = await this.db.department.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { users: true } },
        designations: { select: { id: true, name: true }, orderBy: { name: 'asc' } },
      },
    });
    return rows.map(({ _count, ...d }) => ({ ...d, memberCount: _count.users }));
  }

  @Post()
  create(@Body() body: unknown) {
    const data = parseBody(departmentBody, body);
    return friendly(
      this.db.$transaction(async (tx) => {
        const dept = await tx.department.create({ data: { ...data, businessId: tenantId() } });
        await audit(tx, { entity: 'department', entityId: dept.id, action: 'create', after: dept });
        return dept;
      }),
    );
  }

  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const data = parseBody(departmentBody, body);
    const before = await this.getOrThrow(id);
    return friendly(
      this.db.$transaction(async (tx) => {
        const after = await tx.department.update({ where: { id }, data });
        await audit(tx, { entity: 'department', entityId: id, action: 'update', before, after });
        return after;
      }),
    );
  }

  /** Adds a designation (job title) under this department. */
  @Post(':id/designations')
  async addDesignation(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { name } = parseBody(designationBody, body);
    await this.getOrThrow(id);
    return friendly(
      this.db.$transaction(async (tx) => {
        const row = await tx.designation.create({ data: { name, departmentId: id, businessId: tenantId() } });
        await audit(tx, { entity: 'designation', entityId: row.id, action: 'create', after: row });
        return { id: row.id, name: row.name };
      }),
    );
  }

  /** Deleting a department keeps its members; they are left without a department. */
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const before = await this.getOrThrow(id);
    await this.db.$transaction(async (tx) => {
      await tx.user.updateMany({ where: { departmentId: id }, data: { departmentId: null } });
      await tx.department.delete({ where: { id } });
      await audit(tx, { entity: 'department', entityId: id, action: 'delete', before });
    });
  }
}

/** Rename or remove one designation. Members who hold it follow the change. */
@Roles('admin')
@RequireModule('departments')
@Controller('admin/designations')
export class DesignationsController {
  constructor(@Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient) {}

  private async getOrThrow(id: string) {
    const row = await this.db.designation.findUnique({ where: { id } });
    if (!row) throw notFound();
    return row;
  }

  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { name } = parseBody(designationBody, body);
    const before = await this.getOrThrow(id);
    return friendly(
      this.db.$transaction(async (tx) => {
        const after = await tx.designation.update({ where: { id }, data: { name } });
        await tx.user.updateMany({
          where: { departmentId: before.departmentId, designation: before.name },
          data: { designation: name },
        });
        await audit(tx, { entity: 'designation', entityId: id, action: 'update', before, after });
        return { id: after.id, name: after.name };
      }),
    );
  }

  /** Members who held this designation keep their department and are left without a designation. */
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const before = await this.getOrThrow(id);
    await this.db.$transaction(async (tx) => {
      await tx.user.updateMany({
        where: { departmentId: before.departmentId, designation: before.name },
        data: { designation: null },
      });
      await tx.designation.delete({ where: { id } });
      await audit(tx, { entity: 'designation', entityId: id, action: 'delete', before });
    });
  }
}
