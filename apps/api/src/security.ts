import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { ZodError } from 'zod';
import { Prisma } from '@restaurant/database';
import pino from 'pino';
import type { Response } from 'express';
import type { ApiRequest } from './auth/authorization';
export const logger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
  redact: ['password', 'passwordHash', 'accessToken', 'refreshToken', 'authorization', 'cookie'],
});
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<ApiRequest>();
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Request could not be completed';
    if (error instanceof ZodError) {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = 'Invalid input';
    } else if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
      status = 400;
      code = 'INVALID_JSON';
      message = 'Invalid JSON body';
    } else if (error instanceof Error && 'type' in error && error.type === 'entity.too.large') {
      status = 413;
      code = 'BODY_TOO_LARGE';
      message = 'Request body is too large';
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      code = `HTTP_${status}`;
      message = error.message;
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (['P2002', 'P2003', 'P2034'].includes(error.code)) {
        status = 409;
        code = 'CONFLICT';
        message = 'Operation conflicts with existing data; refresh and retry';
      } else if (error.code === 'P2025') {
        status = 404;
        code = 'NOT_FOUND';
        message = 'Record not found';
      }
    }
    if (status >= 500)
      logger.error(
        {
          requestId: request.requestId,
          errorType: error instanceof Error ? error.constructor.name : 'Unknown',
        },
        'Request failed',
      );
    response
      .status(status)
      .json({ statusCode: status, code, message, requestId: request.requestId });
  }
}
