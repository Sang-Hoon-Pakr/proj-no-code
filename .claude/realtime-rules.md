# realtime-rules — 실시간 채팅 invariants

## 연결 수명주기

- 연결 시 JWT 검증 + **fan-out에 영향 주는 모든 setup (room join, presence 등록)** 은 **`afterInit`의 미들웨어에서 완료**. `handleConnection`은 클라이언트 `connect` 이벤트와 race 가능 — fan-out 의존 setup 금지.
- 미들웨어 거부는 `next(new Error(...))` → 클라이언트 `connect_error` 이벤트로 핸드셰이크 단계에서 차단.
- 핑/퐁 주기 25초 (Socket.IO 기본). 무응답 60초 → 서버가 끊음.
- 클라이언트는 백그라운드 진입 시 연결 유지 시도하지 말고 정리. foreground 복귀 시 재연결.

## 재연결

- **Exponential backoff: 1s → 2s → 4s → ... 최대 30s. Jitter ±20%.**
- 즉시 재연결 금지 (서버 과부하 유발).
- 5회 실패하면 사용자에게 "연결 끊김" 배너 표시.

## 메시지 전송

- 클라이언트가 `messageId(UUIDv7)` 생성. 서버는 검증 + dedupe.
- 전송 흐름:
  1. 클라이언트: 로컬 DB에 `status=sending` 저장 + 화면에 즉시 표시.
  2. 서버에 emit (ack 대기).
  3. ack 받으면 `status=sent`. 5초 안에 ack 없으면 `status=failed` → 사용자 재시도 버튼.
- 같은 `messageId` 재전송 시 서버는 1건만 저장. 응답은 항상 success.

## 메시지 수신 / 순서

- 서버는 `seq`(방 단위 단조증가) 부여. 클라이언트는 `seq`로 정렬.
- 클라이언트는 마지막 본 `seq`를 저장. 재연결 시 `messages:since` 요청으로 누락분 동기화.
- 같은 `messageId` 중복 수신은 클라이언트가 무시 (at-least-once 전제).

## Presence

- Redis `SET user:<id>:online EX 60`로 표현. 클라이언트가 30초마다 heartbeat.
- 친구의 presence 변경은 fan-out — 친구 목록 사이즈 큰 사용자는 throttle 5초.
- offline 전환은 즉시 broadcast 하지 말고 60s grace (재연결 흔함).

## 그룹방

- 방 인원 ≤ 500. 초과 시 자동으로 "오픈채팅" 모델로 분기 (별도 설계).
- 메시지 fan-out은 **Redis pub/sub로 노드 간 라우팅**. 직접 in-memory broadcast 금지.

## 읽음 처리

- read receipt는 batch (1초 디바운스 후 전송).
- 1:1방: 마지막 읽은 `messageId`만 저장.
- 그룹방: 사용자×메시지 단위 저장하지 말고, 사용자별 `lastReadSeq` 저장 후 카운트는 계산.

## 백프레셔

- 클라이언트가 슬로우 컨슈머면 서버가 큐 ≥ 1000 시 disconnect.
- 큰 첨부(이미지/동영상)는 WS로 보내지 않는다. S3 presigned URL 후 메타데이터만 WS로.
