---
date: 2026-05-15
stage: PR-D 첫 CI 실행
module: realtime-rules
severity: medium
status: rule-added
---

## 무엇을 시도했나

WS 게이트웨이 PR-D 푸시 후 CI 실행. 로컬 7번 연속 그린, CI 1회만 실패.

## 무엇이 실패했나

- **증상/에러:** `timeout waiting for message:new` (3초)
- **재현 절차:**
  1. Alice, Bob 둘 다 register/login
  2. Direct room 생성
  3. 두 소켓이 토큰으로 연결
  4. Bob이 `message:new` 리스닝 시작
  5. Alice가 `message:send` emit
  6. Bob이 3초 안에 받지 못함
- **영향 범위:** "fan-out: other room members receive" 1건만. 다른 테스트는 fan-out에 의존하지 않아 그린.
- **로컬 vs CI:** 로컬은 빠른 머신이라 우연히 race 통과. CI는 느려서 노출.

## 왜 실패했나 (근본 원인)

**`handleConnection`은 클라이언트의 `connect` 이벤트보다 늦게 완료될 수 있음.** 시퀀스:

1. 클라이언트가 ioClient(...) — 핸드셰이크
2. 서버 미들웨어 통과 → 클라이언트 `connect` 이벤트 발화
3. 서버 `handleConnection` 시작 (비동기) — `await socket.join(roomId)` 실행 중
4. 클라이언트가 즉시 `message:send` 보냄
5. 서버: 메시지 처리 후 `to(roomId).emit('message:new', ...)`
6. **Bob 소켓은 아직 roomId에 가입 안 됨** → fan-out 누락

`handleConnection`의 동작은 `connect` 이벤트와 **병렬**. 클라이언트가 connect 받았다고 server-side join 완료를 보장하지 않음.

## 어떤 룰이 있었으면 막을 수 있었나

- **추가할 룰 (한 줄, 측정 가능):**
  > "Socket.IO에서 fan-out에 영향 주는 모든 setup(join, presence 등록 등)은 **미들웨어**(`server.use`)에서 완료. `handleConnection`은 connect 이벤트와 race 가능 — fan-out 의존 setup 금지."
- **추가할 파일:** `.claude/realtime-rules.md`
- **자동화 후보:**
  - [ ] WS 연결 직후 메시지 송신 시나리오를 통합테스트에 항상 포함 (CI는 로컬보다 느려서 race 드러내기 좋음)

## 후속 조치

- [x] join 로직을 `afterInit`의 미들웨어로 이동, `handleConnection` 제거
- [x] realtime-rules.md에 한 줄 추가
- [x] CI 재실행 그린 확인
