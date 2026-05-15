# 데이터 모델

> 스키마 초안. ORM(Prisma/TypeORM) 채택 시 이걸 기반으로 마이그레이션 작성.

## 엔티티

### users

| 컬럼              | 타입                     | 비고           |
| ----------------- | ------------------------ | -------------- |
| id                | UUID PK                  | UUIDv7         |
| phone             | VARCHAR(20) UNIQUE       | 정규화된 E.164 |
| email             | VARCHAR(255) UNIQUE NULL | 선택           |
| password_hash     | VARCHAR(255)             | argon2id       |
| nickname          | VARCHAR(50) NOT NULL     |                |
| profile_image_url | TEXT NULL                | S3 URL         |
| status_message    | VARCHAR(200) NULL        | "상태메시지"   |
| created_at        | TIMESTAMPTZ              |                |
| updated_at        | TIMESTAMPTZ              |                |

### user_devices

푸시 토큰 + 세션 관리.
| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | UUID PK | |
| user_id | UUID FK | |
| device_id | VARCHAR(100) | 앱 설치 식별자 |
| platform | ENUM('ios','android') | |
| push_token | TEXT | FCM token |
| last_seen_at | TIMESTAMPTZ | |

### friendships

양방향 친구 관계.
| 컬럼 | 타입 | 비고 |
|---|---|---|
| user_id | UUID FK | (user_id, friend_id) PK |
| friend_id | UUID FK | |
| nickname_alias | VARCHAR(50) NULL | 친구에게 부여한 별칭 |
| is_favorite | BOOLEAN DEFAULT false | |
| created_at | TIMESTAMPTZ | |

### blocks

차단 관계. friendships와 분리.
| 컬럼 | 타입 | 비고 |
|---|---|---|
| blocker_id | UUID FK | (blocker_id, blocked_id) PK |
| blocked_id | UUID FK | |
| created_at | TIMESTAMPTZ | |

### rooms

| 컬럼             | 타입                   | 비고                        |
| ---------------- | ---------------------- | --------------------------- |
| id               | UUID PK                | UUIDv7                      |
| type             | ENUM('direct','group') |                             |
| name             | VARCHAR(100) NULL      | direct은 NULL, group은 필수 |
| image_url        | TEXT NULL              | 그룹방 썸네일               |
| created_by       | UUID FK                |                             |
| last_message_seq | BIGINT DEFAULT 0       | 방 단위 단조증가            |
| created_at       | TIMESTAMPTZ            |                             |

### room_members

| 컬럼          | 타입                   | 비고                  |
| ------------- | ---------------------- | --------------------- |
| room_id       | UUID FK                | (room_id, user_id) PK |
| user_id       | UUID FK                |                       |
| role          | ENUM('member','admin') | group only            |
| joined_at     | TIMESTAMPTZ            |                       |
| last_read_seq | BIGINT DEFAULT 0       | 안읽음 카운트 계산용  |

### messages

가장 큰 테이블. 월별 파티셔닝 권장.
| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | UUID PK | 클라이언트 생성 UUIDv7 (idempotency key) |
| room_id | UUID FK | |
| sender_id | UUID FK | |
| seq | BIGINT NOT NULL | 방 단위 단조증가 (room_id, seq) UNIQUE |
| type | ENUM('text','image','video','file','system') | |
| content | TEXT NULL | text 본문 또는 미디어 caption |
| media_url | TEXT NULL | S3 URL |
| media_meta | JSONB NULL | width/height/duration/size |
| reply_to_id | UUID NULL | 답장 대상 |
| is_deleted | BOOLEAN DEFAULT false | soft delete |
| created_at | TIMESTAMPTZ | 정렬 보조 키 |

**인덱스**

- `(room_id, seq)` — 시간순 조회
- `(room_id, created_at DESC)` — 페이지네이션
- `(sender_id, created_at DESC)` — 사용자별 메시지 (관리/신고용)

### message_reads (그룹방용, 옵션)

대규모 그룹방은 사용자×메시지 단위 저장 X. 대신 `room_members.last_read_seq`로 처리.
1:1방은 이 테이블 자체가 불필요 (last_read_seq로 충분).

### push_logs (옵션, 디버깅용)

| 컬럼       | 타입                            | 비고 |
| ---------- | ------------------------------- | ---- |
| id         | UUID PK                         |      |
| user_id    | UUID FK                         |      |
| message_id | UUID FK NULL                    |      |
| status     | ENUM('sent','failed','expired') |      |
| provider   | ENUM('fcm','apns')              |      |
| error_code | VARCHAR(50) NULL                |      |
| created_at | TIMESTAMPTZ                     |      |

## Redis 키 스킴

| 키                  | 타입    | TTL   | 용도                   |
| ------------------- | ------- | ----- | ---------------------- |
| `user:<id>:online`  | string  | 60s   | presence               |
| `user:<id>:sockets` | set     | -     | 다중 연결 추적         |
| `auth:fail:<ip>`    | counter | 15m   | 로그인 실패 카운트     |
| `rate:msg:<userId>` | counter | 1s/1m | 메시지 전송 제한       |
| `pubsub:room:<id>`  | channel | -     | 노드 간 메시지 fan-out |

## 마이그레이션 원칙

- 컬럼 추가는 NULL 허용 또는 default 값으로 시작 → 백필 → NOT NULL 변경 (3단계).
- 컬럼 삭제 전 코드에서 참조 제거 후 1주 대기.
- enum 값 추가 OK, 삭제는 금지 (별도 컬럼으로 마이그레이션).
- 운영 DB에 직접 ALTER 금지. 마이그레이션 도구 통과 (예: `prisma migrate`).
