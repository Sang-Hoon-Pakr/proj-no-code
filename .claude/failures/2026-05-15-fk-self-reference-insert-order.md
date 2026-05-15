---
date: 2026-05-15
stage: AuthService refresh token rotation TDD
module: coding-style / 신규 db-rules 후보
severity: medium
status: rule-added
---

## 무엇을 시도했나

`AuthService.rotatePair` — refresh token 회전 트랜잭션:

1. 기존 토큰 row에 `used_at = NOW(), replaced_by = newId` UPDATE
2. 새 토큰 row INSERT (id = newId)

## 무엇이 실패했나

- **증상/에러:** `insert or update on table "refresh_tokens" violates foreign key constraint "refresh_tokens_replaced_by_fkey"`
- **재현 절차:** 새 사용자 등록 → 로그인 → refresh 호출 → 위 트랜잭션 진입 → 1번 단계에서 FK 검증 즉시 실패.
- **영향 범위:** refresh rotation 3개 테스트 전부 실패. login/register는 정상.

## 왜 실패했나 (근본 원인)

PostgreSQL FK 제약은 **기본적으로 IMMEDIATE 모드** — UPDATE/INSERT 실행 시점에 즉시 체크. `replaced_by`가 `refresh_tokens(id)`를 가리키는 self-reference인데, UPDATE 시점에 참조하는 `newId` row가 아직 INSERT되지 않은 상태.

순서를 바꾸면 됨 (INSERT 먼저 → UPDATE 나중) 또는 FK를 `DEFERRABLE INITIALLY DEFERRED`로 정의.

## 어떤 룰이 있었으면 막을 수 있었나

- **추가할 룰 (한 줄, 측정 가능):**
  > "self-reference FK가 있는 트랜잭션: 참조 대상 row INSERT가 참조하는 UPDATE/INSERT보다 먼저. 순서 어렵다면 `DEFERRABLE INITIALLY DEFERRED`로 정의."
- **추가할 파일:** `.claude/coding-style.md` (SQL 트랜잭션 절 추가)
- **자동화 후보:**
  - [ ] SQL 마이그레이션 리뷰 체크리스트에 "self-ref FK 발견 시 deferred 검토" 항목

## 후속 조치

- [x] `rotatePair`에서 INSERT → UPDATE 순서로 변경
- [x] `coding-style.md`에 SQL 트랜잭션 룰 한 줄 추가
- [x] 통합테스트 재실행 그린 확인
