---
date: 2026-05-15
stage: pre-push 훅 검증
module: testing-rules
severity: low
status: rule-added
---

## 무엇을 시도했나

`.husky/pre-push`가 호출하는 `pnpm test:unit` (= `vitest run --dir src`) 동작 확인.

## 무엇이 실패했나

- **증상/에러:** `No test files found, exiting with code 1`
- **재현 절차:**
  1. `apps/server/package.json` 스크립트: `"test:unit": "vitest run --dir src"`
  2. `vitest.config.ts`의 `include: ['src/**/*.spec.ts', 'tests/**/*.spec.ts']`
  3. `--dir`는 vitest의 project root(cwd)를 바꾸는 옵션 — **필터가 아님**.
  4. `src` cwd + `src/**/*.spec.ts` include → `src/src/**` 에서 찾음 → 0건.
- **영향 범위:** 모든 pre-push가 즉시 실패. 푸시 자체 차단.

## 왜 실패했나 (근본 원인)

**CLI 플래그의 의미를 추측해서 사용.** `--dir`이 디렉토리 필터일 것이라고 가정 — Vitest 문서는 cwd 변경이라고 명시. 의미 다른 옵션을 같은 이름으로 가진 도구들 (Jest의 `--testPathPattern` 같은 것) 때문에 혼동.

## 어떤 룰이 있었으면 막을 수 있었나

- **추가할 룰 (한 줄, 측정 가능):**
  > "CLI 플래그 사용 전 `<tool> --help` 또는 공식 문서 1회 확인. 직관적 이름이라도 의미 가정 금지."
  > "Vitest는 디렉토리 필터로 **positional argument** 사용 (`vitest run src` 또는 glob)."
- **추가할 파일:** `.claude/testing-rules.md` (Vitest 사용 절)
- **자동화 후보:**
  - [ ] `pnpm test:unit`/`test:integration` 결과가 항상 1건 이상 매칭 — 0건이면 CI fail (의도된 0은 명시 플래그 필요)

## 후속 조치

- [x] `apps/server/package.json` 스크립트:
  - `test:unit`: `vitest run --dir src` → `vitest run src` (positional)
  - `test:integration`: `vitest run --dir tests/integration` → `vitest run tests/integration`
- [x] testing-rules에 한 줄 추가
- [x] pre-push 재실행 검증
