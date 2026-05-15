import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  EmailTakenError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  RefreshTokenReuseError,
  ValidationError,
} from '../auth/auth.service';
import {
  BlockedRelationError,
  GroupTooLargeError,
  NotAuthorizedError,
  RoomNotFoundError,
  SelfRoomError,
} from '../room/room.service';
import { NotInRoomError } from '../message/message.service';
import { ProfileValidationError, UserNotFoundError } from '../user/user.service';
import { BlockSelfError } from '../block/block.service';
import { RateLimitError } from './errors';

interface ErrorMapping {
  status: number;
  code: string;
  title: string;
}

// api-conventions.md: RFC 7807 + detail.code ENUM
// security-rules.md: refresh 재사용 감지는 클라이언트에 일반 invalid로 통일 (공격 노출 X)
const ERROR_MAP = new Map<new (...args: never[]) => Error, ErrorMapping>([
  [ValidationError, { status: 422, code: 'VALIDATION', title: 'Validation failed' }],
  [EmailTakenError, { status: 409, code: 'EMAIL_TAKEN', title: 'Email already taken' }],
  [InvalidCredentialsError, { status: 401, code: 'INVALID_CREDENTIALS', title: 'Unauthorized' }],
  [InvalidRefreshTokenError, { status: 401, code: 'INVALID_REFRESH_TOKEN', title: 'Unauthorized' }],
  [RefreshTokenReuseError, { status: 401, code: 'INVALID_REFRESH_TOKEN', title: 'Unauthorized' }],
  [SelfRoomError, { status: 422, code: 'SELF_ROOM', title: 'Invalid room request' }],
  [BlockedRelationError, { status: 403, code: 'BLOCKED', title: 'Blocked relation' }],
  [GroupTooLargeError, { status: 422, code: 'GROUP_TOO_LARGE', title: 'Group exceeds size limit' }],
  [NotAuthorizedError, { status: 403, code: 'NOT_AUTHORIZED', title: 'Not authorized' }],
  [RoomNotFoundError, { status: 404, code: 'NOT_FOUND', title: 'Not found' }],
  [NotInRoomError, { status: 404, code: 'NOT_FOUND', title: 'Not found' }],
  [UserNotFoundError, { status: 404, code: 'NOT_FOUND', title: 'Not found' }],
  [ProfileValidationError, { status: 422, code: 'VALIDATION', title: 'Validation failed' }],
  [BlockSelfError, { status: 422, code: 'BLOCK_SELF', title: 'Cannot block self' }],
  [RateLimitError, { status: 429, code: 'RATE_LIMITED', title: 'Too many requests' }],
]);

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const mapping = this.findMapping(exception);
    if (mapping) {
      // RateLimitError는 Retry-After 헤더 + detail.retryAfter 추가 (RFC 7231).
      if (exception instanceof RateLimitError) {
        response.setHeader('Retry-After', String(exception.retryAfterSec));
        response.status(mapping.status).json({
          type: 'about:blank',
          title: mapping.title,
          status: mapping.status,
          detail: { code: mapping.code, retryAfter: exception.retryAfterSec },
          instance: request.url,
        });
        return;
      }
      this.respond(response, request, mapping);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      this.respond(response, request, {
        status,
        code: 'HTTP_ERROR',
        title: exception.message,
      });
      return;
    }

    // security-rules.md: 메시지 본문/스택트레이스 응답에 노출 금지.
    this.logger.error(exception);
    this.respond(response, request, {
      status: 500,
      code: 'INTERNAL',
      title: 'Internal server error',
    });
  }

  private respond(response: Response, request: Request, mapping: ErrorMapping): void {
    response.status(mapping.status).json({
      type: 'about:blank',
      title: mapping.title,
      status: mapping.status,
      detail: { code: mapping.code },
      instance: request.url,
    });
  }

  private findMapping(exception: unknown): ErrorMapping | undefined {
    if (typeof exception !== 'object' || exception === null) return undefined;
    const ctor = exception.constructor as new (...args: never[]) => Error;
    return ERROR_MAP.get(ctor);
  }
}
