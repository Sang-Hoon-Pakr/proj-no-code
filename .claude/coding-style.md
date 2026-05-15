# coding-style — 측정 가능한 코드 규칙

> 추상어 금지. "깨끗하게" 같은 표현은 두지 않는다.

## TypeScript

- `any` 금지. 정 필요하면 `unknown` + 타입 가드.
- `as` 강제 캐스팅 금지. 단, JSON 파싱 직후 Zod 통과 결과는 허용.
- `enum` 대신 `as const` 객체 + union 타입 사용.
- 함수 반환 타입은 public/exported 면 명시. 내부 함수는 추론 허용.

## 함수 / 파일 크기

- 함수 30줄 초과 → 분리. 예외는 `// reason:` 주석으로 명시.
- 파일 300줄 초과 → 모듈 분리 검토. 단순 상수/타입 모음은 예외.

## 네이밍

- boolean: `is/has/can/should` 접두 (`isOnline`, `hasUnread`).
- 함수: 동사로 시작 (`sendMessage`, `markAsRead`).
- 이벤트 핸들러: `on<Event>` (props), `handle<Event>` (내부).
- 비동기 함수에 `Async` 접미 붙이지 않는다 (타입이 말해줌).

## 금지된 패턴

- `console.log` 커밋 금지. 디버깅은 NestJS Logger / RN `__DEV__` 가드.
- 매직 넘버 금지. `const MAX_MESSAGE_LEN = 5000` 식으로 추출.
- 깊은 중첩 (`if/if/if`) 3단 초과 금지. early return으로 평탄화.
- catch 후 무시(`catch {}`) 금지. 최소한 Logger.warn.

## 비동기

- `Promise.all`을 쓸 수 있는 순차 `await` 발견 시 병렬화.
- 루프 안 `await` 사용 시 의도된 직렬화인지 주석으로 명시.
- 취소 가능한 비동기는 `AbortSignal` 받기.

## 의존성

- 새 npm 패키지 추가 전 사용자에게 확인. 번들 사이즈 영향 클 수 있음.
- date 처리: `date-fns` 사용. `moment` 금지.

## SQL 트랜잭션

- self-reference FK가 있는 테이블: 트랜잭션 안에서 **참조 대상 row를 먼저 INSERT**한 뒤 참조하는 UPDATE/INSERT. PG의 FK 검증은 기본 IMMEDIATE.
- 순서 강제 어렵다면 마이그레이션에 `DEFERRABLE INITIALLY DEFERRED` 명시.
- 트랜잭션 안에서 발생한 에러는 반드시 ROLLBACK 후 throw. silent swallow 금지.

## NestJS DI

- factory provider의 `inject` 배열: 클래스로 export된 provider는 **클래스 토큰 그대로**(`RoomService`), Symbol/string 토큰은 export된 그 토큰 자체 사용. 문자열 fallback 금지 (런타임 lookup 실패).
- 동일 토큰을 두 모듈에서 provide 금지 — `@Global()` 또는 단일 모듈에서 export.
