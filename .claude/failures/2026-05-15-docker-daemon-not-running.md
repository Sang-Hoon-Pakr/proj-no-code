---
date: 2026-05-15
stage: 메시지 idempotency TDD - 첫 통합테스트 실행
module: environment-rules / testing-rules
severity: medium
status: rule-added
---

## 무엇을 시도했나

`message-idempotency.spec.ts` 통합 테스트 실행 (`pnpm test:integration`). Testcontainers로 PostgreSQL 컨테이너 띄우는 단계.

## 무엇이 실패했나

- **증상/에러:** `Could not find a working container runtime strategy`
- **실제 원인:** `docker info` 확인 결과 — `Cannot connect to the Docker daemon at unix:///Users/shpark/.docker/run/docker.sock. Is the docker daemon running?`
- **재현 절차:**
  1. Docker CLI는 설치돼 있음 (`docker --version` 정상).
  2. Docker Desktop 앱은 미실행.
  3. Testcontainers가 socket 못 찾고 즉시 실패.
- **영향 범위:** integration 테스트 0건 실행. TDD green 단계 진입 불가.

## 왜 실패했나 (근본 원인)

**"Docker 설치돼 있음"과 "daemon이 떠있음"은 다르다.** `environment-rules.md`에 "Docker daemon 실행 중이어야 함"이라고 적혀있었지만, **실제로 켜져있는지 사전 확인 단계가 없음**. 룰을 적어두는 것만으로는 부족 — pre-flight check 또는 명확한 에러 메시지 필요.

## 어떤 룰이 있었으면 막을 수 있었나

- **추가할 룰 (한 줄, 측정 가능):**
  > "`pnpm test:integration` 진입 시 Docker daemon 상태 사전 검사. daemon down이면 명령 즉시 종료 + 시작 방법 안내."
- **추가할 파일:** `apps/server/scripts/check-docker.mjs` (pre-flight) + `package.json` 스크립트 prepend
- **자동화 후보:**
  - [x] `test:integration` 스크립트에 docker 체크 prepend
  - [ ] 더 멀리: pre-push 훅에도 통합테스트 옵션 (Docker 있을 때만)

## 후속 조치

- [x] `scripts/check-docker.mjs` 추가
- [x] `test:integration` 스크립트가 체크 통과해야 진입
- [x] 사용자에게 Docker Desktop 시작 요청 (`open -a Docker`)
- [x] daemon up 후 테스트 재실행
