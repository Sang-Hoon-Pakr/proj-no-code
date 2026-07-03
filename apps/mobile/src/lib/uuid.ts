import * as Crypto from 'expo-crypto';

const UUID_BYTES = 16;
const TIMESTAMP_BYTES = 6;
const RANDOM_BYTES = UUID_BYTES - TIMESTAMP_BYTES;

// RFC 9562 UUIDv7 — 48bit unix ms 타임스탬프(big-endian) + version/variant + 74bit 랜덤.
// realtime-rules.md: messageId는 클라이언트가 UUIDv7로 생성 (재시도 시 동일 ID → 멱등성).
// nowMs/randomBytes 주입은 테스트용 — expo-crypto 네이티브 모듈은 jest 환경에 없음.
export function uuidv7(nowMs = Date.now(), randomBytes?: Uint8Array): string {
  const bytes = new Uint8Array(UUID_BYTES);
  let ts = nowMs;
  for (let i = TIMESTAMP_BYTES - 1; i >= 0; i--) {
    bytes[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  const rand = randomBytes ?? Crypto.getRandomBytes(RANDOM_BYTES);
  bytes.set(rand.subarray(0, RANDOM_BYTES), TIMESTAMP_BYTES);
  bytes[6] = 0x70 | (bytes[6] & 0x0f); // version 7
  bytes[8] = 0x80 | (bytes[8] & 0x3f); // variant 10xx

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
