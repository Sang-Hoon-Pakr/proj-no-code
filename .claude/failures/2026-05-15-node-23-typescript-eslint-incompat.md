---
date: 2026-05-15
stage: 서버 스캐폴딩 초기 pnpm install
module: workflow / 신규 environment-rules 후보
severity: medium
status: rule-added
---

## 무엇을 시도했나

NestJS + Vitest + ESLint 의존성을 추가한 `apps/server/package.json`을 만들고 워크스페이스 루트에서 `pnpm install` 실행.

## 무엇이 실패했나

- **증상/에러:**
  ```
  ERR_PNPM_UNSUPPORTED_ENGINE  Unsupported environment (bad pnpm and/or Node.js version)
  Your Node version is incompatible with "eslint-visitor-keys@5.0.1".
  Expected version: ^20.19.0 || ^22.13.0 || >=24
  Got: v23.7.0
  ```
- **재현 절차:**
  1. Node 23.7.0 (current, non-LTS) 환경
  2. `@typescript-eslint/eslint-plugin: ^8.4.0` 의존성 추가
  3. caret 범위로 인해 8.59.3이 해석됨
  4. 이게 끌어오는 `eslint-visitor-keys@5.0.1`가 Node 23 제외
- **영향 범위:** 모든 서버 종속성 설치 실패. 사이클 진입 불가.

## 왜 실패했나 (근본 원인)

1. **Node 버전이 LTS가 아님.** Node 23은 odd-numbered current 릴리스 — 대부분 메이저 툴체인이 LTS만 공식 지원함.
2. **engines 호환성 사전 점검 없이 caret 범위로 의존성 추가.** caret 범위가 minor를 올려서 더 엄격한 engines 요구하는 신버전을 끌어옴.

## 어떤 룰이 있었으면 막을 수 있었나

- **추가할 룰 (한 줄, 측정 가능):**
  > "Node는 LTS만 사용 (현재는 22.x 또는 24+). 23.x 같은 odd current 금지. `.nvmrc`로 프로젝트 단위 강제."
  > "외부 lib 추가 전 `npm view <pkg> engines` 또는 `engines.node` 확인. 못 맞추면 다른 버전 채택 또는 도구 교체."
- **추가할 파일:** `.claude/environment-rules.md` (신규)
- **자동화 후보:**
  - [x] `.nvmrc` 도입 — IDE/CI에서 자동 감지
  - [x] root `package.json` engines 범위 강화
  - [ ] pre-commit hook으로 `node -v`와 `.nvmrc` 일치 검사

## 후속 조치

- [x] 룰 추가 (`.claude/environment-rules.md` 신규)
- [x] `.nvmrc` 추가 (Node 22 LTS)
- [x] root `package.json` engines 범위 좁힘
- [x] `@typescript-eslint/*` 패키지를 Node 23 호환 버전(`8.4.x`)으로 고정
- [x] 재설치 검증
- [ ] CI에서 Node LTS 강제 (CI 도입 시)
