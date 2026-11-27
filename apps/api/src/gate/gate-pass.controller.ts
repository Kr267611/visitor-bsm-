import { Controller, Get, Inject, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { GatePass } from '@visitor/shared';
import { RequireModule } from '../auth/permissions';
import { AuthUser, CurrentUser, Roles } from '../auth/roles.decorator';
import { ApiException } from '../common/api-exception';
import { RECEPTION_DESK } from '../common/records';
import { istDayRange } from '../common/time';
import { StorageService } from '../storage/storage.service';
import { TENANT_PRISMA, TenantPrismaClient } from '../tenancy/tenant-prisma';

const PASS_INCLUDE = {
  visitor: true,
  host: true,
  premises: { include: { business: true } },
  inGate: true,
  outGate: true,
} as const;
type PassVisit = Prisma.VisitGetPayload<{ include: typeof PASS_INCLUDE }>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 92;
const MAX_ROWS = 2000;

/** Gate passes: the printable exit slip of one visit, and the register of visits by date. */
@Roles('guard', 'reception', 'security', 'admin')
@RequireModule('desk')
@Controller()
export class GatePassController {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrismaClient,
    private readonly storage: StorageService,
  ) {}

  @Get('visits/:id/gate-pass')
  async one(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<GatePass> {
    const visit = await this.prisma.visit.findUnique({ where: { id }, include: PASS_INCLUDE });
    if (!visit || visit.businessId !== user.businessId || !user.premisesIds.includes(visit.premisesId)) {
      throw new ApiException(404, 'NOT_FOUND', 'Gate pass not found.');
    }
    const out = await this.prisma.visitEvent.findFirst({
      where: { visitId: id, type: 'CHECK_OUT' },
      orderBy: { occurredAt: 'desc' },
      select: { actorId: true },
    });
    const actor = out?.actorId
      ? await this.prisma.user.findUnique({ where: { id: out.actorId }, select: { name: true } })
      : null;
    return this.toPass(visit, actor?.name ?? null);
  }

  /** Visits that came in at the user's premises between two India dates, newest first. */
  @Get('gate-passes')
  async list(
    @CurrentUser() user: AuthUser,
    @Query('from') from = '',
    @Query('to') to = '',
    @Query('q') q = '',
  ): Promise<GatePass[]> {
    if (!user.premisesId) throw new ApiException(422, 'VALIDATION_FAILED', 'Your account has no premises assigned.');
    if (!DAY.test(from) || !DAY.test(to)) throw new ApiException(422, 'VALIDATION_FAILED', 'Choose the dates.');
    const start = istDayRange(from).start;
    const end = istDayRange(to).end;
    if (end <= start) throw new ApiException(422, 'VALIDATION_FAILED', 'The end date must be on or after the start date.');
    if (end.getTime() - start.getTime() > MAX_DAYS * 86_400_000) {
      throw new ApiException(422, 'VALIDATION_FAILED', `Choose ${MAX_DAYS} days or fewer.`);
    }
    const text = q.trim().slice(0, 60);
    const rows = await this.prisma.visit.findMany({
      where: {
        premisesId: user.premisesId,
        checkedInAt: { gte: start, lt: end },
        ...(text && {
          OR: [
            { visitor: { name: { contains: text, mode: 'insensitive' } } },
            { visitor: { company: { contains: text, mode: 'insensitive' } } },
            { visitor: { phone: { contains: text } } },
            { gatePassNo: { contains: text, mode: 'insensitive' } },
            { code: { contains: text, mode: 'insensitive' } },
          ],
        }),
      },
      include: PASS_INCLUDE,
      orderBy: { checkedInAt: 'desc' },
      take: MAX_ROWS,
    });
    return rows.map((row) => this.toPass(row, null));
  }

  private toPass(v: PassVisit, checkedOutBy: string | null): GatePass {
    return {
      visitId: v.id,
      gatePassNo: v.gatePassNo,
      visitCode: v.code,
      status: v.status,
      businessName: v.premises.business.name,
      premisesName: v.premises.name,
      visitorName: v.visitor.name,
      company: v.visitor.company,
      phone: v.visitor.phone,
      photoUrl: v.visitor.photoKey ? this.storage.photoUrl(v.visitor.photoKey) : null,
      hostName: v.host?.name ?? RECEPTION_DESK,
      purpose: v.purpose,
      purposeNote: v.purposeNote,
      inAt: v.checkedInAt?.toISOString() ?? null,
      outAt: v.checkedOutAt?.toISOString() ?? null,
      inGate: v.inGate?.name ?? null,
      outGate: v.outGate?.name ?? null,
      itemsOut: v.itemsOut,
      checkedOutBy,
    };
  }
}
