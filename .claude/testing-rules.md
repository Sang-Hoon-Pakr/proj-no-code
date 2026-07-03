# testing-rules — 테스트 작성 규칙

## 프레임워크 (확정)

- 서버 유닛/통합: **Vitest**
- 서버 E2E (HTTP): **Vitest + supertest**
- 앱 유닛: **Jest** (RN 공식 지원)
- 앱 E2E: **Detox** (iOS/Android 실제 빌드)

## Mock 정책

- **DB(PostgreSQL) mock 금지.** Testcontainers로 실제 컨테이너 띄움.
- **Redis mock 금지.** Testcontainers `redis:7-alpine`.
- **Socket.IO mock 금지.** 실제 서버 + 클라이언트 페어로 통신.
- 외부 SaaS(FCM/APNs/S3)만 mock 허용. 인터페이스 경계에서.
- "유닛이라서 mock 한다"는 정당화 금지. 통합 테스트로 작성한다.

## 테스트 구조

- 파일명: `<대상>.spec.ts` (유닛/통합), `<flow>.e2e.ts` (E2E).
- `describe` 한 단계만 중첩. 안에 또 `describe` 금지.
- `beforeAll`로 컨테이너 띄우고 `afterAll`로 정리. 테스트 간 DB는 truncate.
- 한 테스트당 assertion 1~3개. 과한 multi-assertion 금지.

## 커버리지

- 라인 70% 이상. 도메인 로직(messaging/auth)은 90% 이상.
- 커버리지 미달 PR은 머지 차단 (CI에서 검사).
- "커버리지를 위한 테스트" 금지. 의미 없는 테스트는 차라리 삭제.

## 메신저 특화 필수 테스트

- 메시지 전송 idempotency: 같은 `messageId`로 2번 보내도 1건만 저장.
- WebSocket 재연결 시 missed messages 동기화 (since cursor 기반).
- 차단 사용자의 메시지는 수신자에 도달 X.
- 1:1방과 그룹방의 read receipt 모델 분리 검증.
- 푸시 토큰 갱신 후 구토큰으로 발송 시 graceful failure.

## 금지

- 테스트 안에서 `sleep()`/`setTimeout` 고정값 대기. `waitFor` / polling 사용.
- 테스트 간 순서 의존. 단독 실행도 가능해야 함.
- `.only`, `.skip` 커밋. CI에서 검사.

## Jest (모바일) 사용 주의

- pnpm 모노레포에서 jest preset(jest-expo 등)의 `transformIgnorePatterns`는 `.pnpm` 경로를 못 잡는다 — `node_modules/(?!(?:\.pnpm/)?(<allowlist>))` 형태로 오버라이드 필수.

## Vitest 사용 주의

- 디렉토리 필터는 **positional argument** (`vitest run src`). `--dir`는 cwd 변경이지 필터 아님.
- 테스트 0건 매칭은 기본 fail (exit 1) — 의도된 빈 매칭은 `--passWithNoTests` 명시.
- CLI 플래그 의미는 추측 금지. `vitest --help` 1회 확인.
