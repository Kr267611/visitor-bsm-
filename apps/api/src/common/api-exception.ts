import { HttpException } from '@nestjs/common';
import type { ErrorCode } from '@visitor/shared';

export class ApiException extends HttpException {
  constructor(status: number, code: ErrorCode, message: string, extra: object = {}) {
    super({ error: code, message, ...extra }, status);
  }
}
