import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ApiException } from './api-exception';

const CODE_BY_STATUS: Record<number, { error: string; message: string }> = {
  400: { error: 'VALIDATION_FAILED', message: 'Bheji gayi jaankari sahi nahi hai.' },
  401: { error: 'UNAUTHORIZED', message: 'Dobara login karein.' },
  422: { error: 'VALIDATION_FAILED', message: 'Bheji gayi jaankari sahi nahi hai.' },
  403: { error: 'FORBIDDEN', message: 'Aapko iski permission nahi hai.' },
  404: { error: 'NOT_FOUND', message: 'Yeh cheez nahi mili.' },
  413: { error: 'VALIDATION_FAILED', message: 'File bahut badi hai.' },
};

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiError');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof ApiException) {
      res.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = CODE_BY_STATUS[status] ?? { error: 'VALIDATION_FAILED', message: exception.message };
      res.status(status).json(body);
      return;
    }
    this.logger.error(exception);
    res.status(500).json({ error: 'INTERNAL', message: 'Kuch gadbad ho gayi. Dobara koshish karein.' });
  }
}
