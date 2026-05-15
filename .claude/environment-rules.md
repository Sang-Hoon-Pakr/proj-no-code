# environment-rules — 개발 환경 invariants

## Node

- **LTS만 사용.** 현재 권장: **22.x** (또는 24+). 23, 21 같은 odd current 금지.
- `.nvmrc`로 프로젝트 버전 명시. IDE/CI/로컬 모두 동일.
- root `package.json` `engines.node`는 **구체적 범위로 좁힌다.** `>=20` 같은 광범위 X.

## 패키지 매니저

- **pnpm 9.x 통일.** npm/yarn 혼용 금지.
- corepack 사용 (글로벌 설치 X). `packageManager` 필드로 버전 고정.
- root에 `package-lock.json`/`yarn.lock` 발견 시 즉시 삭제.

## 새 의존성 추가 절차

1. `pnpm view <pkg> engines` 로 Node 호환성 먼저 확인.
2. 못 맞추면 → 더 낮은 호환 버전 채택 / 다른 도구 교체. **engines 무시하고 강제 설치 금지.**
3. caret(`^`) 범위가 위험한 패키지는 **틸드(`~`) 또는 고정 버전** 사용:
   - 린트/포매터 (자주 minor에 breaking 끼움) → `~`
   - 빌드 도구 → `~` 또는 고정
   - 일반 라이브러리 → `^` OK
4. 새 의존성 PR에는 "왜 필요" 본문에 명시.

## Docker

- Testcontainers 사용 — 로컬에 Docker daemon 실행 중이어야 함.
- 이미지 태그 명시 (`postgres:16-alpine`). `latest` 금지.
- **통합테스트 스크립트는 진입 시 daemon 사전검사 필수** (`scripts/check-docker.mjs`).
  daemon down이면 명확한 안내 메시지와 함께 즉시 종료. 추측 에러로 디버깅 시간 낭비 금지.

## 격리

- `.env` 커밋 금지 (`.gitignore` 처리). `.env.example`만 커밋.
- 시크릿은 macOS Keychain / 1Password CLI 등 외부에. 코드에 X.

## 점검

- 새 PR 머지 전 `corepack prepare pnpm@<버전>` 출력이 `packageManager` 필드와 일치하는지 확인.
- 월 1회 `pnpm outdated`로 보안 패치 미반영 의존성 점검.

## 스크립트 작성

- lint/format 스크립트는 `.` + 설정 파일의 `ignores`로 범위 제어. 명시 경로 인자는 존재 보장 시에만.
- glob 패턴(`**/*.ts`)도 매칭 0이면 도구가 에러 — 가능하면 설정 파일에 위임.
