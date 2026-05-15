-- 0001_initial: 기초 도메인 스키마 (users, auth, rooms, messages)
-- 데이터 모델 문서: docs/data-model.md

CREATE TABLE users (
  id            UUID PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id   UUID NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  replaced_by UUID REFERENCES refresh_tokens(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_refresh_tokens_family ON refresh_tokens (family_id);

CREATE TABLE blocks (
  blocker_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE rooms (
  id          UUID PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('direct', 'group')),
  name        TEXT,
  created_by  UUID NOT NULL REFERENCES users(id),
  last_seq    BIGINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE room_members (
  room_id        UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id),
  role           TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  joined_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_seq  BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE direct_room_keys (
  user_a_id  UUID NOT NULL,
  user_b_id  UUID NOT NULL,
  room_id    UUID NOT NULL UNIQUE REFERENCES rooms(id) ON DELETE CASCADE,
  PRIMARY KEY (user_a_id, user_b_id),
  CHECK (user_a_id < user_b_id)
);

CREATE TABLE messages (
  id          UUID PRIMARY KEY,
  room_id     UUID NOT NULL REFERENCES rooms(id),
  sender_id   UUID NOT NULL REFERENCES users(id),
  content     TEXT NOT NULL,
  seq         BIGINT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, seq)
);
