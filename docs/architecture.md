# 시스템 아키텍처

> 사람이 읽기 위한 문서다. 룰은 [.claude/](../.claude/)에 있고, 이건 _왜 이 구조인지_ 설명한다.

## 전체 구성

```
[ React Native App (iOS/Android) ]
        │
        │  HTTPS (REST)       WSS (Socket.IO)
        ▼                      ▼
┌────────────────────────────────────────────┐
│           NestJS API Gateway               │
│  ┌──────────┐ ┌──────────┐ ┌────────────┐  │
│  │  Auth    │ │ Message  │ │ Presence   │  │
│  │ Module   │ │  Module  │ │  Module    │  │
│  └──────────┘ └──────────┘ └────────────┘  │
└────────────────────────────────────────────┘
        │              │              │
        ▼              ▼              ▼
   PostgreSQL       Redis         S3 (media)
   (영속 데이터)    (presence/    (이미지/동영상)
                   pubsub/cache)

   외부:  FCM (Android push) / APNs (iOS push, FCM 경유)
```

## 컴포넌트

### React Native App

- 화면: 친구 목록 / 채팅방 목록 / 채팅창 / 프로필 / 설정
- 로컬 저장: SQLite (WatermelonDB 또는 op-sqlite)
- 상태관리: Zustand (Redux는 boilerplate 과함)
- WebSocket: Socket.IO client + 자체 재연결 로직 (realtime-rules 참조)

### NestJS Server

- **Auth Module**: 회원가입/로그인/토큰 발급/리프레시 로테이션
- **User Module**: 프로필, 친구 관계, 차단
- **Room Module**: 1:1방, 그룹방 생성/조회/멤버 관리
- **Message Module**: 메시지 생성/조회/삭제 (idempotency 처리)
- **WS Gateway**: Socket.IO 게이트웨이, presence + 메시지 fan-out
- **Push Module**: FCM/APNs 토큰 관리 및 발송

### 데이터 저장

- **PostgreSQL**: 사용자/방/메시지/관계 등 영속 데이터
- **Redis**:
  - presence (`user:<id>:online` TTL 60s)
  - 인증 시도 카운터 (rate limit)
  - WS 노드 간 pub/sub (다중 인스턴스 fan-out)
- **S3**: 미디어. presigned URL로 직접 업로드/다운로드.

## 핵심 흐름

### 메시지 전송

1. 앱: `messageId(UUIDv7)` 생성, 로컬 DB에 `status=sending` 기록, 화면 즉시 표시.
2. 앱 → 서버 WS: `message:send { roomId, messageId, content, type }`.
3. 서버: dedupe 확인 → PG 저장 → 방 멤버 fan-out.
4. fan-out: 같은 서버 노드 멤버는 직접 emit, 다른 노드는 Redis pubsub로 라우팅.
5. 서버: 발신자에게 ack `{ messageId, seq, serverTs }`.
6. 앱: ack 받고 `status=sent` + `seq` 반영. 5초 무응답 시 `status=failed`.

### 재연결 동기화

1. 앱: WS disconnect 감지, exponential backoff로 재연결.
2. 재연결 성공 → 각 방에 대해 `messages:since { roomId, lastSeq }` 요청.
3. 서버: `lastSeq` 이후 메시지 전부 반환 (페이지네이션 적용).
4. 앱: 받은 메시지를 `messageId`로 dedupe 후 로컬 DB 병합.

### 푸시 알림

1. 앱이 백그라운드이거나 disconnect 상태일 때.
2. 서버: 메시지 fan-out 시 수신자 WS 미연결이면 FCM/APNs 발송.
3. 페이로드는 보안상 메시지 본문 제외. `roomId`, `senderId`, `messageId`만.
4. 앱: 푸시 탭 → 딥링크로 해당 방의 해당 메시지로 이동.

## 스케일링 메모 (MVP에선 X, 미리 적어둠)

- WS 노드 수평 확장은 Redis pubsub adapter (`@socket.io/redis-adapter`)로 처리.
- DB는 PG primary + read replica. 메시지 테이블은 월별 파티셔닝.
- Hot room (수만 명 그룹채팅)은 별도 "오픈채팅" 모델로 분리 — 영속화 정책 다름.
- 미디어 CDN은 CloudFront / Cloudflare 전면 배치.

## 미정 (의사결정 필요)

- [ ] 모노레포 vs 폴리레포 (`pnpm` workspaces 기반 모노레포 권장)
- [ ] CI: GitHub Actions vs CircleCI
- [ ] 인프라: AWS vs GCP (서울 리전 기준)
- [ ] 관측: Datadog / Sentry / 자체 ELK 중 선택
- [ ] E2EE 도입 시점과 프로토콜
