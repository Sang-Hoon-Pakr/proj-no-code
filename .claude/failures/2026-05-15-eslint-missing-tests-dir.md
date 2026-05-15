---
date: 2026-05-15
stage: 서버 스캐폴딩 - pnpm verify 첫 실행
module: environment-rules
severity: low
status: rule-added
---

## 무엇을 시도했나

서버 스캐폴딩 완료 후 `pnpm verify` 실행 (lint + typecheck + test).

## 무엇이 실패했나

- **증상/에러:** `ESLint: No files matching the pattern "tests" were found.`
- **재현 절차:**
  1. `apps/server/package.json`의 lint 스크립트가 `eslint src tests --max-warnings 0`.
  2. `apps/server/tests/` 디렉토리가 아직 안 만들어짐 → 매칭 0.
  3. ESLint는 매칭 0 패턴에 대해 exit 2.
- **영향 범위:** 첫 검증 즉시 실패. 사이클 진입 불가.

## 왜 실패했나 (근본 원인)

**스크립트가 존재 보장 없는 경로를 명시 인자로 전달.** ESLint는 명시된 경로가 매칭 0이면 에러 (의도된 동작 — 오타 보호).
스캐폴딩 시점엔 `tests/` 디렉토리가 없는 게 정상인데, 스크립트는 그걸 알 수 없음.

## 어떤 룰이 있었으면 막을 수 있었나

- **추가할 룰 (한 줄, 측정 가능):**
  > "lint/format 스크립트는 명시 경로 대신 `.` + 설정 파일의 ignore로 범위 제어. 경로 인자는 디렉토리 존재 보장될 때만."
- **추가할 파일:** `.claude/environment-rules.md` (스크립트 작성 규칙 섹션)
- **자동화 후보:**
  - [x] eslint 설정에 ignores 추가, 스크립트는 `eslint .`로 단순화

## 후속 조치

- [x] `apps/server/package.json` lint 스크립트: `eslint src tests` → `eslint .`
- [x] `apps/server/eslint.config.mjs` ignores에 `dist`, `node_modules`, `coverage` 명시
- [x] 룰 한 줄 `.claude/environment-rules.md`에 추가
