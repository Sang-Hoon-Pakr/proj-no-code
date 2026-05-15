---
date: 2026-05-15
stage: AuthService refresh rotation TDD - JWT 발급
module: security-rules
severity: low
status: rule-added
---

## 무엇을 시도했나

로그인 후 즉시 refresh → 새 access token 발급. 테스트는 새 access ≠ 이전 access 기대.

## 무엇이 실패했나

- **증상/에러:** `expect(t2.accessToken).not.toBe(t1.accessToken)` 실패. 두 토큰이 동일.
- **재현 절차:** login → refresh를 같은 초 내 (수 ms 차이)에 호출하면 access token이 정확히 같음.
- **영향 범위:** access token 중복 발급 — revocation list 기반 보안 통제 시 식별 충돌. 보안 critical은 아니지만 베스트 프랙티스 위반.

## 왜 실패했나 (근본 원인)

JWT `iat` 클레임은 **초 단위 해상도**. 같은 사용자, 같은 secret, 같은 초에 발급된 토큰은 페이로드가 동일하므로 서명도 동일. 토큰 유일성은 자동 보장되지 않음.

## 어떤 룰이 있었으면 막을 수 있었나

- **추가할 룰 (한 줄, 측정 가능):**
  > "JWT 발급 시 `jti` 클레임 필수 — UUIDv7 또는 randomBytes. 같은 초 발급 충돌 방지 + 향후 토큰 revocation 추적 기반."
- **추가할 파일:** `.claude/security-rules.md` (JWT 절)

## 후속 조치

- [x] `signAccessToken`에 `jti = uuidv7()` 추가
- [x] security-rules.md JWT 섹션에 한 줄 추가
- [x] 테스트 그린 확인
