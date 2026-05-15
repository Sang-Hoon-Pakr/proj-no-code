import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';

export const JWT_SECRET_TOKEN = Symbol('JWT_SECRET');

export interface AuthContext {
  userId: string;
}

interface AuthedRequest extends Request {
  auth?: AuthContext;
}

interface JwtPayload {
  sub: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(JWT_SECRET_TOKEN) private readonly secret: string) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException();
    }
    const token = header.slice('Bearer '.length);
    try {
      const payload = jwt.verify(token, this.secret) as JwtPayload;
      // security-rules.md: 컨트롤러에서 권한 확인 시 req.auth 사용.
      req.auth = { userId: payload.sub };
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
