---
date: 2026-07-03
stage: 방 목록 실시간 갱신 (feat/room-list-live, PR #24)
module: workflow
severity: low
status: rule-added
---

## 무엇을 시도했나

커밋 → push → PR 생성 → `gh pr checks --watch` → `gh pr merge`를 한 셸 체인(&&)으로 실행.

## 무엇이 실패했나

- **증상/에러:** `gh pr checks --watch`가 "no checks reported"로 즉시 exit 0 → 체크 대기 없이 merge 시도 → "the base branch policy prohibits the merge"로 차단.
- **재현 절차:**
  1. `gh pr create ... && gh pr checks --watch ... && gh pr merge ...`
  2. PR 생성 직후 CI 체크가 GitHub에 등록되기 전 타이밍에 checks --watch 도달.
- **영향 범위:** 머지 실패 (안전측 실패 — 보호 룰이 잘못된 머지를 막음). PR #21에서도 같은 현상을 겪고 sleep으로 우회 — 2회 반복.

## 왜 실패했나 (근본 원인)

PR 생성과 CI 체크 등록 사이에 수 초의 gap이 있음. `gh pr checks --watch`는 체크가 0건이면 대기하지 않고 즉시 종료(exit 0)한다.

## 어떤 룰이 있었으면 막을 수 있었나

- **추가할 룰 (한 줄, 측정 가능):**
  > PR 생성과 `gh pr checks --watch`를 한 체인에 묶지 않는다 — 체크 등록 확인 후 감시하거나 `gh pr merge --auto`를 사용.
- **추가할 파일:** `.claude/workflow.md`
- **추가가 어렵다면 자동화로 가능한가:** `gh pr merge --auto`가 구조적 해법 (체크 통과 시 GitHub이 머지).

## 후속 조치

- [x] 룰 추가 (`.claude/workflow.md`)
- [x] 코드 수정 (해당 없음 — 프로세스 실수)
- [x] 회귀 테스트 추가 (해당 없음)
- [x] 같은 패턴 다른 곳에도 있나 확인 (세션 내 반복 패턴이었음 — 이후 `--auto` 사용)
