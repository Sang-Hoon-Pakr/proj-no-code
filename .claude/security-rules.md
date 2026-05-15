# security-rules — 보안 invariants

## 로깅 / PII

- **메시지 본문은 어떤 경로로도 로그/메트릭/에러리포트에 노출 금지.**
  - Sentry 등 에러 리포터엔 `messageId`, `roomId`, length, type만.
  - DB 쿼리 로그에서도 본문 컬럼 마스킹.
- 전화번호, 이메일은 마스킹 후 로그 (`010-****-1234`).

## 인증

- 비밀번호 해시: **argon2id** (`memoryCost=64MB, timeCost=3, parallelism=4`).
- bcrypt 금지 (메모리 코스트 조정 불가).
- JWT:
  - access TTL 15분, refresh TTL 14일.
  - refresh **rotation 필수** (사용 즉시 무효화 + 새 발급).
  - refresh는 httpOnly + secure (앱에선 Keychain/Keystore).
- 로그인 실패 5회 → 15분 잠금 (Redis TTL).

## 입력 검증

- 모든 HTTP/WebSocket 진입점은 **Zod 또는 class-validator로 스키마 검증**.
- 메시지 길이 ≤ 5000자. 초과 시 422.
- 파일 업로드는 서버가 발급한 presigned URL로만. 클라이언트 직접 PUT 금지.

## 권한

- 방 참여자 외 메시지 조회/전송 차단. 매 요청마다 검사.
- 차단(block) 관계는 양방향으로 즉시 적용. 캐시 만료 대기 금지.
- admin/일반 사용자 권한은 컨트롤러 데코레이터로 강제 (`@RequireRole`).

## 통신

- 모든 외부 통신 TLS 1.2+. cleartext HTTP 금지 (RN `ATS` 활성).
- WebSocket은 `wss://` 만. `ws://` 금지.
- 인증서 핀닝 (앱) — 운영 도메인에 적용.

## 비밀

- `.env` 커밋 금지. `.env.example`만 커밋.
- 시크릿은 운영에서 AWS Secrets Manager / Parameter Store로 주입.
- 코드에 하드코딩된 시크릿 패턴은 pre-commit hook (gitleaks)으로 차단.

## E2E 암호화 (Phase 2)

- MVP는 transport 암호화(TLS)만. E2EE는 Signal Protocol 채택 검토 후 별도 설계.
- 미리 메시지 본문 저장 방식을 E2EE 도입에 호환되게 설계 (블롭 저장, 검색 인덱스 분리).
