import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { runInEmptyContext } from './request-context';
import { createTenantClient, TENANT_PRISMA } from './tenant-prisma';

/** Har HTTP request apne khaali context mein chalti hai, taaki ek request ka business doosri mein na jaye. */
export function contextMiddleware(_req: Request, _res: Response, next: NextFunction) {
  runInEmptyContext(next);
}

@Global()
@Module({
  providers: [{ provide: TENANT_PRISMA, useFactory: createTenantClient, inject: [PrismaService] }],
  exports: [TENANT_PRISMA],
})
export class TenancyModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(contextMiddleware).forRoutes('{*path}');
  }
}
