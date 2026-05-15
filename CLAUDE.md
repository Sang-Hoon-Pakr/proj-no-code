# 카카오톡형 모바일 메신저 — Claude 가드레일

> 이 파일은 README가 아니다. **Claude가 같은 실수를 반복하지 않게 하는 instructions**다.
> 코드만 봐도 알 수 있는 건 적지 않는다. 숨겨진 invariants, gotcha, 결정 규칙만 적는다.
> 새로운 실수가 발견되면 즉시 해당 모듈 파일에 추가한다.

## 스택 (확정)

- 앱: **React Native + TypeScript** (iOS/Android 동시)
- 서버: **NestJS + TypeScript**
- DB: **PostgreSQL** (영속) + **Redis** (presence/세션/pubsub)
- 실시간: **Socket.IO** (NestJS gateway)
- 푸시: **FCM** (Android) + **APNs** (iOS, FCM 경유)
- 미디어: **S3 호환 스토리지** + Presigned URL

## 명령어 (절대 추측 금지)

- 한 번에 검증: `pnpm verify` (lint + typecheck + test)
- 린트: `pnpm lint`
- 타입체크: `pnpm typecheck`
- 테스트 전체: `pnpm test`
- 유닛만: `pnpm test:unit`
- 통합만: `pnpm test:integration` (Docker 필요)
- E2E: `pnpm test:e2e` (시뮬레이터/에뮬레이터 필요)
- 서버 dev: `pnpm --filter @app/server dev` (스캐폴딩 후)
- 앱 dev: `pnpm --filter @app/mobile dev` (스캐폴딩 후)

## 최상위 invariants (가장 자주 어기는 것)

1. **메시지 본문은 어떤 로그/메트릭에도 남기지 않는다.** 로그엔 `messageId`, `roomId`, 길이, 타입만.
2. **클라이언트가 `messageId(UUIDv7)`를 생성한다.** 서버는 검증만. 재시도 시 동일 ID로 → 멱등성.
3. **실시간 메시지는 at-least-once.** 중복 가능 전제로 클라이언트는 항상 `messageId`로 dedupe.
4. **WebSocket 재연결은 exponential backoff** (1s → 30s, jitter ±20%). 즉시 재연결 금지.
5. **DB/Redis는 테스트에서 mock 금지.** Testcontainers로 실제 인스턴스 사용.
6. **외부 입력은 Zod 또는 class-validator로 경계에서 검증.** 안 거치고 핸들러 진입 금지.
7. **JWT access token TTL 15분, refresh token rotation 필수.**
8. **`any` 타입 금지.** 정 필요하면 `unknown` + narrow.

## 모듈 룰 (@import)

@./.claude/workflow.md
@./.claude/environment-rules.md
@./.claude/coding-style.md
@./.claude/testing-rules.md
@./.claude/security-rules.md
@./.claude/api-conventions.md
@./.claude/realtime-rules.md
@./.claude/mobile-rules.md
@./.claude/commit-style.md

## 사이클 (모든 작업의 표준)

**Stage → Implement → Test → (fail이면) Capture → Harness Update → Fix → Test 반복**
상세는 [.claude/workflow.md](.claude/workflow.md). 실패 캡처는 [.claude/failures/](.claude/failures/).
스킵·축소 금지. 실수 발견 시 즉시 해당 `.claude/<module>.md` 한 줄 추가.

## 점검 (월 1회)

- [ ] 이 파일 100줄 이하인가
- [ ] 명령어가 채워져 있고 실제로 동작하는가
- [ ] 각 모듈 파일이 50줄 이하인가
- [ ] 코드 보면 알 수 있는 내용이 들어있진 않은가
- [ ] 최근 한 달 내 업데이트 흔적이 있는가
