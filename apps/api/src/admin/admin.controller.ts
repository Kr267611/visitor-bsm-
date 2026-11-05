import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles } from '../auth/roles.decorator';
import { ApiException } from '../common/api-exception';
import { parseBody, requirePhone } from '../common/parse';
import { PrismaService } from '../prisma/prisma.service';

const roleSchema = z.enum(['guard', 'employee', 'reception', 'security', 'admin']);
const uuid = z.string().uuid();

const siteCreate = z.object({ name: z.string().min(1), address: z.string().optional() });
const siteUpdate = siteCreate.partial();
const gateCreate = z.object({ siteId: uuid, name: z.string().min(1) });
const gateUpdate = z.object({ name: z.string().min(1), isActive: z.boolean() }).partial();
const userCreate = z.object({
  name: z.string().min(1),
  phone: z.string(),
  role: roleSchema,
  siteId: uuid,
  email: z.string().email().optional(),
  department: z.string().optional(),
});
const userUpdate = z
  .object({
    name: z.string().min(1),
    role: roleSchema,
    siteId: uuid,
    email: z.string().email().nullable(),
    department: z.string().nullable(),
    isActive: z.boolean(),
  })
  .partial();

const USER_FIELDS = {
  id: true,
  name: true,
  phone: true,
  email: true,
  role: true,
  department: true,
  siteId: true,
  isActive: true,
} as const;

/** Prisma ke unique/foreign-key errors ko saaf 422 mein badalta hai. */
async function friendly<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') throw new ApiException(422, 'VALIDATION_FAILED', 'Yeh mobile number pehle se hai.');
      if (e.code === 'P2003') throw new ApiException(422, 'VALIDATION_FAILED', 'Chuni gayi site ya gate nahi mili.');
      if (e.code === 'P2025') throw new ApiException(404, 'NOT_FOUND', 'Yeh record nahi mila.');
    }
    throw e;
  }
}

@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('sites')
  sites() {
    return this.prisma.site.findMany({ orderBy: { name: 'asc' } });
  }

  @Post('sites')
  createSite(@Body() body: unknown) {
    return this.prisma.site.create({ data: parseBody(siteCreate, body) });
  }

  @Patch('sites/:id')
  updateSite(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return friendly(this.prisma.site.update({ where: { id }, data: parseBody(siteUpdate, body) }));
  }

  @Get('gates')
  gates() {
    return this.prisma.gate.findMany({ orderBy: { name: 'asc' } });
  }

  @Post('gates')
  createGate(@Body() body: unknown) {
    return friendly(this.prisma.gate.create({ data: parseBody(gateCreate, body) }));
  }

  @Patch('gates/:id')
  updateGate(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return friendly(this.prisma.gate.update({ where: { id }, data: parseBody(gateUpdate, body) }));
  }

  @Get('users')
  users() {
    return this.prisma.user.findMany({ select: USER_FIELDS, orderBy: { name: 'asc' } });
  }

  @Post('users')
  createUser(@Body() body: unknown) {
    const data = parseBody(userCreate, body);
    return friendly(
      this.prisma.user.create({
        data: { ...data, phone: requirePhone(data.phone) },
        select: USER_FIELDS,
      }),
    );
  }

  @Patch('users/:id')
  updateUser(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return friendly(
      this.prisma.user.update({ where: { id }, data: parseBody(userUpdate, body), select: USER_FIELDS }),
    );
  }
}

const meUpdate = z.object({ delegateId: uuid.nullable() });

@Controller()
export class ProfileController {
  constructor(private readonly prisma: PrismaService) {}

  private profile(id: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id },
      select: { ...USER_FIELDS, delegateId: true },
    });
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.profile(user.id);
  }

  @Patch('me')
  async updateMe(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { delegateId } = parseBody(meUpdate, body);
    if (delegateId) {
      const delegate = await this.prisma.user.findUnique({ where: { id: delegateId } });
      if (delegateId === user.id || !delegate?.isActive || delegate.siteId !== user.siteId) {
        throw new ApiException(422, 'VALIDATION_FAILED', 'Backup person apni site ka active employee hona chahiye.');
      }
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { delegateId } });
    return this.profile(user.id);
  }

  @Get('gates')
  gates(@CurrentUser() user: AuthUser) {
    return this.prisma.gate.findMany({
      where: { siteId: user.siteId ?? undefined, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, siteId: true },
    });
  }

  @Roles('guard', 'reception', 'employee', 'security', 'admin')
  @Get('users/hosts')
  hosts(@CurrentUser() user: AuthUser, @Query('q') q = '') {
    return this.prisma.user.findMany({
      where: {
        siteId: user.siteId,
        isActive: true,
        name: { contains: q, mode: 'insensitive' },
        role: { in: ['employee', 'reception', 'security', 'admin'] },
      },
      select: { id: true, name: true, department: true },
      orderBy: { name: 'asc' },
      take: 20,
    });
  }
}
