---
date: 2026-05-15
stage: MessageGateway + MessageModule 와이어링 (PR-D)
module: coding-style
severity: low
status: rule-added
---

## 무엇을 시도했나

`MessageModule` factory provider에서 `MessageService(pool, roomService)` 생성. `RoomService`를 inject 배열에 추가.

## 무엇이 실패했나

- **증상/에러:** `Nest can't resolve dependencies of the MessageService (Symbol(PG_POOL), ?). Please make sure that the argument "RoomService" at index [1] is available in the MessageModule context.`
- **재현 절차:**
  1. `inject: [PG_POOL, 'RoomService']` — 문자열 토큰 사용
  2. `RoomModule`은 클래스 토큰 `RoomService`로 export
  3. 토큰 불일치 → DI lookup 실패
- **영향 범위:** 모든 HTTP/WS 테스트가 AppModule 부트 단계에서 실패.

## 왜 실패했나 (근본 원인)

NestJS DI는 **provide 토큰과 inject 토큰이 정확히 같은 참조여야 함**. `RoomService` 클래스 토큰과 문자열 `'RoomService'`는 다른 키. TypeScript 타입은 일치하지만 런타임 lookup에서 분리됨.

## 어떤 룰이 있었으면 막을 수 있었나

- **추가할 룰 (한 줄, 측정 가능):**
  > "NestJS DI factory의 `inject` 배열: 클래스로 export된 provider는 클래스 토큰 그대로(`RoomService`), Symbol/string 토큰은 export된 그 토큰 자체 사용. 문자열 fallback 금지."
- **추가할 파일:** `.claude/coding-style.md` (NestJS 절)

## 후속 조치

- [x] `inject: [PG_POOL, RoomService]`로 수정
- [x] coding-style.md에 한 줄 추가
- [x] 테스트 재실행 그린 확인
