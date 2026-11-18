import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { hashPassword, PASSWORD_MAX, PASSWORD_MIN } from '../auth/password';
import { FEATURES } from '../auth/permissions';
import { Roles } from '../auth/roles.decorator';
import { ApiException } from '../common/api-exception';
import { parseBody, requirePhone } from '../common/parse';
import { friendly, kioskCode, notFound, slugify } from '../common/records';
import { PrismaService } from '../prisma/prisma.service';

const limit = z.number().int().min(0).nullable();
const planCreate = z.object({
  code: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().trim().min(1).max(100),
  features: z.array(z.enum(FEATURES)).default([]),
  visitLimit: limit.optional(),
  premisesLimit: limit.optional(),
  memberLimit: limit.optional(),
});
const planUpdate = planCreate.omit({ code: true }).partial();

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'slug');
const businessCreate = z.object({
  name: z.string().trim().min(1).max(150),
  slug,
  planId: z.string().uuid(),
  otpLogin: z.boolean().optional(),
  premises: z.object({ name: z.string().trim().min(1).max(150), address: z.string().max(300).optional() }),
  admin: z.object({
    name: z.string().trim().min(1).max(100),
    phone: z.string(),
    email: z.string().email().optional(),
    password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX).optional(),
  }),
});
const businessUpdate = z
  .object({ name: z.string().trim().min(1).max(150), planId: z.string().uuid(), otpLogin: z.boolean(), isActive: z.boolean() })
  .partial();

/** Super admin: plans aur businesses (tenants). Yahan raw client, kyunki yeh kisi ek business ke andar nahi. */
@Roles('super_admin')
@Controller('platform')
export class PlatformController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('plans')
  plans() {
    return this.prisma.plan.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { businesses: true } } } });
  }

  @Post('plans')
  createPlan(@Body() body: unknown) {
    return friendly(this.prisma.plan.create({ data: parseBody(planCreate, body) }));
  }

  @Patch('plans/:id')
  updatePlan(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return friendly(this.prisma.plan.update({ where: { id }, data: parseBody(planUpdate, body) }));
  }

  @Get('businesses')
  businesses() {
    return this.prisma.business.findMany({
      orderBy: { name: 'asc' },
      include: {
        plan: { select: { id: true, code: true, name: true } },
        _count: { select: { premises: true, users: true } },
      },
    });
  }

  /** Naya business ek hi transaction mein: default premises + settings + gate + pehla admin. */
  @Post('businesses')
  async createBusiness(@Body() body: unknown) {
    const input = parseBody(businessCreate, body);
    const phone = requirePhone(input.admin.phone);
    if (!(await this.prisma.plan.count({ where: { id: input.planId } }))) {
      throw new ApiException(422, 'VALIDATION_FAILED', 'Chuna gaya plan nahi mila.');
    }
    const passwordHash = input.admin.password ? await hashPassword(input.admin.password) : null;
    return friendly(
      this.prisma.$transaction(async (tx) => {
        const business = await tx.business.create({
          data: { name: input.name, slug: input.slug, planId: input.planId, otpLogin: input.otpLogin ?? true },
        });
        const businessId = business.id;
        const premises = await tx.premises.create({
          data: {
            businessId,
            name: input.premises.name,
            address: input.premises.address,
            code: kioskCode(),
            webSlug: slugify(input.premises.name),
            isDefault: true,
            setting: { create: { businessId } },
          },
        });
        await tx.gate.create({ data: { businessId, premisesId: premises.id, name: 'Main Gate' } });
        const admin = await tx.user.create({
          data: {
            businessId,
            name: input.admin.name,
            phone,
            email: input.admin.email,
            role: 'admin',
            passwordHash,
            premises: { create: { premisesId: premises.id, businessId } },
          },
          select: { id: true, name: true, phone: true, email: true, role: true },
        });
        return { business, premises, admin };
      }),
    );
  }

  @Patch('businesses/:id')
  async updateBusiness(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const data = parseBody(businessUpdate, body);
    if (!(await this.prisma.business.count({ where: { id } }))) throw notFound();
    return friendly(this.prisma.business.update({ where: { id }, data }));
  }
}
