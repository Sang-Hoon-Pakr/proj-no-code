import type { INestApplication } from '@nestjs/common';
import { HttpExceptionFilter } from './common/http-exception.filter';

// main.ts와 통합 테스트가 둘 다 호출 — 한 곳에서 prefix와 filter 일관 적용.
export function setupApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new HttpExceptionFilter());
}
