# packages/shared — 공유 타입/계약

> 서버↔앱 간 공유되는 타입, DTO, 이벤트 명세, Zod 스키마.

## 원칙

- **런타임 의존성 금지.** 순수 타입과 Zod 스키마만.
- 서버에서 정의한 contract를 앱이 import하는 단방향 흐름.
- breaking change는 별도 PR + 양쪽(서버/앱) 동시 업데이트.

## 내용 (예정)

- `src/api/*` — REST 엔드포인트별 request/response 타입.
- `src/ws/*` — WebSocket 이벤트 페이로드 타입.
- `src/models/*` — 도메인 모델 타입 (User, Room, Message).
- `src/schemas/*` — Zod 스키마 (서버/앱 양쪽에서 검증).
