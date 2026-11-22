import { Body, Controller, Get, Headers, HttpCode, Module, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { ApprovalsModule } from '../approvals/approvals.module';
import { Public } from '../auth/roles.decorator';
import { parseBody, requirePhone } from '../common/parse';
import { photoInterceptor, requireJpeg } from '../storage/uploads.controller';
import { SelfCheckInService } from './self-checkin.service';

const location = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(100_000).optional(),
  })
  .optional();
const phoneBody = z.object({ phone: z.string() });
const verifyBody = z.object({ phone: z.string(), otp: z.string().regex(/^\d{6}$/), location });
const checkInBody = z.object({
  name: z.string().trim().min(1).max(100),
  company: z.string().trim().max(100).optional(),
  /** Category of the visit, picked from the premises list. */
  purpose: z.string().trim().min(1, 'Please choose the purpose of your visit.').max(60),
  /** What the visit is about, in the visitor's own words. */
  purposeNote: z.string().trim().min(3, 'Please write a little about your visit.').max(300),
  /** Optional: without it the request goes to the reception desk. */
  hostId: z.string().uuid().optional(),
  photoKey: z.string().min(1).max(300).optional(),
  consent: z.boolean(),
  location,
});

/** Session header: a short-lived token from /verify, bound to one premises and one phone. */
const SESSION_HEADER = 'x-checkin-session';

@Public()
@Throttle({ default: { limit: () => Number(process.env.PUBLIC_RATE_LIMIT ?? 20), ttl: 60_000 } })
@Controller('public/premises/:business/:premises')
export class SelfCheckInController {
  constructor(private readonly service: SelfCheckInService) {}

  @Get()
  info(@Param('business') business: string, @Param('premises') premises: string) {
    return this.service.info(business, premises);
  }

  @Post('otp')
  @HttpCode(204)
  async otp(@Param('business') business: string, @Param('premises') premises: string, @Body() body: unknown) {
    await this.service.sendOtp(business, premises, requirePhone(parseBody(phoneBody, body).phone));
  }

  @Post('verify')
  @HttpCode(200)
  verify(@Param('business') business: string, @Param('premises') premises: string, @Body() body: unknown) {
    const input = parseBody(verifyBody, body);
    return this.service.verify(business, premises, requirePhone(input.phone), input.otp, input.location);
  }

  @Get('hosts')
  async hosts(
    @Param('business') business: string,
    @Param('premises') premises: string,
    @Headers(SESSION_HEADER) token: string | undefined,
    @Query('q') q = '',
  ) {
    const { p } = await this.service.session(business, premises, token);
    return this.service.hosts(p, q.trim().slice(0, 60));
  }

  @Post('photo')
  @UseInterceptors(photoInterceptor())
  async photo(
    @Param('business') business: string,
    @Param('premises') premises: string,
    @Headers(SESSION_HEADER) token: string | undefined,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    const { s } = await this.service.session(business, premises, token);
    return this.service.savePhoto(s, requireJpeg(file));
  }

  @Post('check-in')
  async checkIn(
    @Param('business') business: string,
    @Param('premises') premises: string,
    @Headers(SESSION_HEADER) token: string | undefined,
    @Body() body: unknown,
  ) {
    const { p, s } = await this.service.session(business, premises, token);
    return this.service.checkIn(p, s, parseBody(checkInBody, body));
  }

  @Post('check-out')
  @HttpCode(200)
  async checkOut(
    @Param('business') business: string,
    @Param('premises') premises: string,
    @Headers(SESSION_HEADER) token: string | undefined,
  ) {
    const { p, s } = await this.service.session(business, premises, token);
    return this.service.checkOut(p, s);
  }
}

@Module({
  imports: [ApprovalsModule],
  controllers: [SelfCheckInController],
  providers: [SelfCheckInService],
})
export class SelfCheckInModule {}
