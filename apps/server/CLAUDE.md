# apps/server — NestJS 서버 가드레일

> 루트 [CLAUDE.md](../../CLAUDE.md)와 `.claude/*.md`가 먼저 적용된다. 여기는 **서버 한정** 규칙.

## 명령어

- 개발: `pnpm dev` (watch 모드)
- 빌드: `pnpm build`
- 테스트: `pnpm test`
- 통합 테스트: `pnpm test:integration` (Docker 필요)
- 마이그레이션 생성: `pnpm db:migrate:create <name>`
- 마이그레이션 적용: `pnpm db:migrate:deploy`

## 서버 한정 invariants

- **컨트롤러는 비즈니스 로직 금지.** 검증/직렬화만. 로직은 Service.
- **Repository 패턴.** Service는 ORM 객체를 직접 만지지 않고 Repository 인터페이스 통해.
- **WebSocket 핸들러 try/catch 필수.** 안 잡으면 소켓 끊김.
- **트랜잭션 경계는 Service 메서드 1개당 1개.** 중첩 트랜잭션 금지.
- **순환 의존성 발견 시 작업 멈춤.** NestJS `forwardRef` 사용 전 모듈 재설계 검토.
- **DTO는 class-validator + class-transformer.** Zod와 혼용 금지 (둘 중 하나로 통일).

## 환경변수

- `.env.example`에 모든 키 명시. 새 키 추가 시 `.env.example`도 PR에 포함.
- `ConfigService.get()` 호출 시 default 값 금지 — 누락 키는 시작 시점에 fail-fast.

## 디렉토리

- `src/modules/<domain>/` — 도메인별 (auth, user, room, message, ws, push).
- `src/common/` — 공용 (filters, interceptors, decorators, guards).
- `src/database/` — 마이그레이션 + seed.

## 로깅

- NestJS Logger 사용. `console.log` 금지.
- 요청 로그는 `RequestId` 인터셉터로. UUID 부여 후 응답 헤더 `X-Request-Id`로도 반환.
- ERROR 레벨은 Sentry로 전송. WARN 이하는 stdout만.
