---
date: 2026-05-15
stage: MessageGateway 연결 인증 (PR-D)
module: realtime-rules
severity: low
status: rule-added
---

## 무엇을 시도했나

`handleConnection`에서 JWT 검증 후 실패 시 `client.disconnect(true)` 호출.

## 무엇이 실패했나

- **증상/에러:** 클라이언트는 먼저 `connect` 이벤트를 받고, 그 다음에야 `disconnect`. 테스트의 connectSocket 헬퍼가 `connect`에 resolve해버려 "rejects connection" 검증 실패.
- **재현 절차:** 토큰 없이 또는 잘못된 토큰으로 ioClient(...) 연결 → 서버가 handleConnection에서 disconnect 호출 → 클라이언트는 connect → 즉시 disconnect 순으로 받음.
- **영향 범위:** "connection auth" 테스트 2건 실패. 보안적으론 결과 동일(연결 끊김)이지만 핸드셰이크 단계에서 거부 못함.

## 왜 실패했나 (근본 원인)

**`handleConnection`은 핸드셰이크 완료 후 호출.** 따라서 거부해도 클라이언트 입장에선 한 번 connect 성공함. 실제 핸드셰이크 거부는 **Socket.IO middleware (`io.use`)**에서 해야 함 — NestJS는 `afterInit` lifecycle 훅에서 `server.use()`로 등록.

## 어떤 룰이 있었으면 막을 수 있었나

- **추가할 룰 (한 줄, 측정 가능):**
  > "Socket.IO 핸드셰이크 단계 인증/거부는 `afterInit`에서 `server.use(middleware)`로 등록. `handleConnection`은 인증이 끝난 후의 join 등에 한정."
- **추가할 파일:** `.claude/realtime-rules.md`

## 후속 조치

- [x] MessageGateway에 `afterInit` 추가, JWT 검증을 middleware로 이동
- [x] handleConnection은 join 작업만
- [x] realtime-rules.md에 한 줄 추가
