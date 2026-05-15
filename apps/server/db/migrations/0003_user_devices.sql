-- 0003_user_devices: 디바이스 + 푸시 토큰 (data-model.md user_devices)

CREATE TABLE user_devices (
  id            UUID PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id     VARCHAR(100) NOT NULL,
  platform      TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  push_token    TEXT,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, device_id)
);

CREATE INDEX idx_user_devices_user ON user_devices (user_id);
