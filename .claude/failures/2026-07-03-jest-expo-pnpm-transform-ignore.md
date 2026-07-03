---
date: 2026-07-03
stage: 모바일 Jest 셋업 (feat/chat-room-screen)
module: testing-rules
severity: medium
status: rule-added
---

## 무엇을 시도했나

apps/mobile에 jest + jest-expo(~51) 셋업 후 첫 유닛 테스트(`src/lib/messages.spec.ts`) 실행.

## 무엇이 실패했나

- **증상/에러:** `SyntaxError: Unexpected identifier 'ErrorHandler'` — `@react-native/js-polyfills/error-guard.js`의 Flow 타입 문법이 변환 없이 로드됨.
- **재현 절차:**
  1. `apps/mobile/package.json`에 `"jest": { "preset": "jest-expo" }`만 설정.
  2. `pnpm --filter @app/mobile test` 실행.
- **영향 범위:** 모바일 테스트 전체 (테스트 0건 실행, suite 자체가 부팅 실패).

## 왜 실패했나 (근본 원인)

jest-expo preset의 기본 `transformIgnorePatterns`는 `node_modules/(?!(react-native|@react-native|expo|...))` 형태 — **npm/yarn의 평평한 node_modules 경로를 전제**한다. pnpm은 실제 파일이 `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/...`에 있어서 첫 `node_modules/` 뒤에 `.pnpm/`이 오고, allowlist lookahead가 실패 → RN/expo 패키지가 transform 대상에서 제외됨 → Flow 문법이 그대로 jest-runtime에 도달.

## 어떤 룰이 있었으면 막을 수 있었나

- **추가할 룰 (한 줄, 측정 가능):**
  > pnpm 모노레포에서 jest preset의 `transformIgnorePatterns` 사용 시 `node_modules/(?!(?:\.pnpm/)?(<allowlist>))`로 `.pnpm/` 세그먼트를 명시적으로 처리한다.
- **추가할 파일:** `.claude/testing-rules.md`
- **추가가 어렵다면 자동화로 가능한가:** 룰로 충분 (셋업 1회성).

## 후속 조치

- [x] 룰 추가 (`.claude/testing-rules.md`)
- [x] 코드 수정 (`apps/mobile/package.json`의 jest 설정에 transformIgnorePatterns 오버라이드)
- [x] 회귀 테스트 추가 (기존 spec이 곧 회귀 테스트 — suite 부팅 자체가 검증)
- [x] 같은 패턴 다른 곳에도 있나 grep 확인 (서버는 Vitest — transformIgnorePatterns 미사용)
