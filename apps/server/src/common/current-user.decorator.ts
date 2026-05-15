import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext } from './jwt.guard';

// JwtAuthGuard가 req.auth를 채워두므로 컨트롤러에서 단순 추출.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const req = ctx.switchToHttp().getRequest<Request & { auth?: AuthContext }>();
    if (!req.auth) {
      throw new Error('CurrentUser used without JwtAuthGuard');
    }
    return req.auth;
  },
);
