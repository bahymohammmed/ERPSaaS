import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { ApiErrorBody } from '@erp/shared';
import type { Response } from 'express';
import { AppError } from './app-error';

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ErrorFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof AppError) {
      const body: ApiErrorBody = { error: { code: exception.code, params: exception.params, issues: exception.issues } };
      response.status(exception.status).json(body);
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = status === 404 ? 'NOT_FOUND' : status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : 'VALIDATION_FAILED';
      response.status(status).json({ error: { code, params: { entity: 'route' } } } satisfies ApiErrorBody);
      return;
    }
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    response.status(500).json({ error: { code: 'INTERNAL' } } satisfies ApiErrorBody);
  }
}
