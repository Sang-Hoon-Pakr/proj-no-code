# api-conventions — REST/WS API 규칙

## REST

- Base: `/api/v1`. 메이저 변경 시 `/v2`로 분기, 구버전은 6개월 유지.
- 리소스 경로는 복수형 명사. `/users`, `/rooms`, `/messages`.
- 동사 경로 금지 (`/getUser` X). 행위는 sub-resource나 PATCH.
  - 예외: 도메인 액션 (`POST /rooms/:id/leave`, `POST /messages/:id/read`).
- ID는 path param. 필터링은 query string. body는 생성/수정 payload만.

## 응답 / 에러

- 성공: `{ data: ... }` 래핑. 페이지네이션은 `{ data: [...], cursor, hasMore }`.
- 에러: **RFC 7807** 포맷 (`type`, `title`, `status`, `detail`, `instance`).
- 비즈니스 에러 코드는 `detail.code`에 ENUM 문자열 (`USER_BLOCKED`, `ROOM_FULL`).
- 404와 403 구분 누설 주의. 권한 없는 자원은 404로 통일 가능 (security-rules 참조).

## 페이지네이션

- **Cursor 기반만 사용.** offset 페이지네이션 금지 (메시지 양 많음).
- cursor는 `messageId` + `createdAt` 조합을 base64 인코딩.
- 기본 page size 30, max 100.

## 시간

- 서버 응답 시간은 모두 **ISO 8601 UTC** (`2026-05-14T12:00:00.000Z`).
- 타임존 변환은 클라이언트 책임.
- 메시지 정렬 기준은 서버 `createdAt`. 클라이언트 시계 신뢰 금지.

## WebSocket 이벤트 명명

- 형식: `<domain>:<action>` (`message:new`, `room:joined`, `presence:changed`).
- 클라이언트 → 서버는 ack callback 필수. 서버는 5초 내 ack.
- 서버 → 클라이언트는 fire-and-forget. 클라이언트가 응답 줘야 하면 별도 ack 이벤트.

## 버저닝

- API 응답에 `X-API-Version` 헤더 포함.
- breaking change는 deprecation 헤더 30일 선행 (`Deprecation`, `Sunset`).

## Rate limit

- 인증 API: IP당 분당 10회.
- 메시지 전송: 사용자당 초당 5건, 분당 100건.
- 초과 시 `429` + `Retry-After` 헤더.
