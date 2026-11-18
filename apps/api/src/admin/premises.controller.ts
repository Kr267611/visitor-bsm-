import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { Roles } from '../auth/roles.decorator';
import { audit } from '../audit/audit.service';
import { ApiException } from '../common/api-exception';
import { parseBody } from '../common/parse';
import { friendly, kioskCode, notFound, slugify } from '../common/records';
import { PlanLimits } from '../plans/plan-limits.service';
import { tenantId } from '../tenancy/request-context';
import { TENANT_PRISMA, TenantPrismaClient } from '../tenancy/tenant-prisma';

const uuid = z.string().uuid();
const premisesCreate = z.object({
  name: z.string().trim().min(1).max(150),
  address: z.string().max(300).optional(),
  mobile: z.string().max(20).optional(),
  email: z.string().email().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  geofenceM: z.number().int().positive().max(100_000).optional(),
  category: z.enum(['business', 'events', 'exhibition']).optional(),
  purposes: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  isDefault: z.boolean().optional(),
});
const premisesUpdate = premisesCreate.partial();

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const minutes = (max: number) => z.number().int().min(1).max(max);
const settingsUpdate = z
  .object({
    visitStart: hhmm.nullable(),
    visitEnd: hhmm.nullable(),
    checkinOnApproval: z.boolean(),
    onlyCheckin: z.boolean(),
    autoCheckoutHrs: z.number().int().min(1).max(72).nullable(),
    overstayMin: minutes(1440).nullable(),
    waitingMin: minutes(1440).nullable(),
    defaultVisitMin: z.number().int().min(15).max(1440),
    slotMin: z.number().int().min(5).max(240),
    delayAlertMin: minutes(1440).nullable(),
    onlyMemberCheckin: z.boolean(),
    reportEmails: z.array(z.string().email()).max(10),
    reportSchedule: z.enum(['daily', 'weekly', 'monthly']).nullable(),
    googleReviewUrl: z.string().url().startsWith('https://').max(500).nullable(),
  })
  .partial()
  .strict();

const gateCreate = z.object({ premisesId: uuid, name: z.string().trim().min(1).max(100) });
const gateUpdate = z.object({ name: z.string().trim().min(1).max(100), isActive: z.boolean() }).partial();

/** Premises, unki settings aur gates. Scoped client: sab queries apne business tak. */
@Roles('admin')
@Controller('admin')
export class PremisesController {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly limits: PlanLimits,
  ) {}

  private async premisesOrThrow(id: string) {
    const row = await this.db.premises.findUnique({ where: { id } });
    if (!row) throw notFound();
    return row;
  }

  @Get('premises')
  list() {
    return this.db.premises.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
  }

  @Post('premises')
  async create(@Body() body: unknown) {
    const businessId = tenantId();
    const data = parseBody(premisesCreate, body);
    await this.limits.assert(businessId, 'premises');
    const base = slugify(data.name);
    const taken = await this.db.premises.count({ where: { webSlug: { startsWith: base } } });
    const isFirst = !(await this.db.premises.count());
    return friendly(
      this.db.$transaction(async (tx) => {
        if (data.isDefault) await tx.premises.updateMany({ data: { isDefault: false } });
        const premises = await tx.premises.create({
          data: {
            ...data,
            businessId,
            code: kioskCode(),
            webSlug: taken ? `${base}-${taken + 1}` : base,
            isDefault: data.isDefault ?? isFirst,
          },
        });
        await tx.premisesSetting.create({ data: { premisesId: premises.id, businessId } });
        await audit(tx, { entity: 'premises', entityId: premises.id, action: 'create', after: premises });
        return premises;
      }),
    );
  }

  @Patch('premises/:id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const data = parseBody(premisesUpdate, body);
    const before = await this.premisesOrThrow(id);
    if (data.isDefault === false && before.isDefault) {
      throw new ApiException(422, 'VALIDATION_FAILED', 'Ek premises default rehna chahiye; doosre ko default banayein.');
    }
    return this.db.$transaction(async (tx) => {
      if (data.isDefault) await tx.premises.updateMany({ where: { id: { not: id } }, data: { isDefault: false } });
      const after = await tx.premises.update({ where: { id }, data });
      await audit(tx, { entity: 'premises', entityId: id, action: 'update', before, after });
      return after;
    });
  }

  @Get('premises/:id/settings')
  async settings(@Param('id', ParseUUIDPipe) id: string) {
    const row = await this.db.premisesSetting.findUnique({ where: { premisesId: id } });
    if (!row) throw notFound();
    return row;
  }

  @Put('premises/:id/settings')
  async updateSettings(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const data = parseBody(settingsUpdate, body);
    const before = await this.settings(id);
    const visitStart = data.visitStart !== undefined ? data.visitStart : before.visitStart;
    const visitEnd = data.visitEnd !== undefined ? data.visitEnd : before.visitEnd;
    if (visitStart && visitEnd && visitStart >= visitEnd) {
      throw new ApiException(422, 'VALIDATION_FAILED', 'Visit ka end time start ke baad ka hona chahiye.');
    }
    return this.db.$transaction(async (tx) => {
      const after = await tx.premisesSetting.update({ where: { premisesId: id }, data });
      await audit(tx, { entity: 'premises_settings', entityId: id, action: 'update', before, after });
      return after;
    });
  }

  @Get('gates')
  gates() {
    return this.db.gate.findMany({ orderBy: { name: 'asc' } });
  }

  @Post('gates')
  async createGate(@Body() body: unknown) {
    const data = parseBody(gateCreate, body);
    await this.premisesOrThrow(data.premisesId).catch(() => {
      throw new ApiException(422, 'VALIDATION_FAILED', 'Chuna gaya premises nahi mila.');
    });
    return this.db.$transaction(async (tx) => {
      const gate = await tx.gate.create({ data: { ...data, businessId: tenantId() } });
      await audit(tx, { entity: 'gate', entityId: gate.id, action: 'create', after: gate });
      return gate;
    });
  }

  @Patch('gates/:id')
  async updateGate(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const data = parseBody(gateUpdate, body);
    const before = await this.db.gate.findUnique({ where: { id } });
    if (!before) throw notFound();
    return this.db.$transaction(async (tx) => {
      const after = await tx.gate.update({ where: { id }, data });
      await audit(tx, { entity: 'gate', entityId: id, action: 'update', before, after });
      return after;
    });
  }
}
