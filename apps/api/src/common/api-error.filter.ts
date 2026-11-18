import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import type { Response } from 'express';
import { ApiException } from './api-exception';

const CODE_BY_STATUS: Record<number, { error: string; message: string }> = {
  400: { error: 'VALIDATION_FAILED', message: 'The request is not valid.' },
  401: { error: 'UNAUTHORIZED', message: 'Please sign in again.' },
  422: { error: 'VALIDATION_FAILED', message: 'The request is not valid.' },
  403: { error: 'FORBIDDEN', message: 'You do not have permission to do this.' },
  404: { error: 'NOT_FOUND', message: 'Not found.' },
  413: { error: 'VALIDATION_FAILED', message: 'The file is too large.' },
  429: { error: 'RATE_LIMITED', message: 'Too many requests. Please try again shortly.' },
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
    Sentry.captureException(exception);
    res.status(500).json({ error: 'INTERNAL', message: 'Something went wrong. Please try again.' });
  }
}
