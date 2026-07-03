# workflow — 작업 사이클 규칙 (가장 중요)

> 모든 작업은 이 사이클을 따른다. 단축/스킵 금지.
> 목적: 같은 실수를 두 번 하지 않게 만드는 self-healing harness.

## 사이클

```
START → IMPLEMENT → TEST ──pass──→ STAGE DONE
                     │
                    fail
                     ▼
                  CAPTURE (.claude/failures/)
                     │
                     ▼
                  HARNESS UPDATE (.claude/<module>.md)
                     │
                     ▼
                   FIX ──→ TEST  (loop until pass)
```

## 단계별 룰

### 1. Stage 시작

- 작업 단위 1개로 한정. 1 PR = 1 stage.
- DoD (Definition of Done) 체크리스트를 todo로 기록.
- 영향받는 `.claude/<module>.md`를 미리 식별 (룰 추가 위치 예상).

### 2. Implement

- 작은 커밋으로 진행 (squash merge 전제지만 추적용).
- 룰 위반 의심 시 작업 멈추고 룰 먼저 확인.

### 3. Test (스킵 금지)

- 명령어: `pnpm verify` (lint + typecheck + 영향 영역 test)
- 새 기능이면 새 테스트 1개 이상 추가 (testing-rules 참조).
- 빨강이면 4번으로, 초록이면 stage 완료.

### 4. CAPTURE (실패 즉시)

- `.claude/failures/YYYY-MM-DD-<slug>.md` 작성. `_template.md` 복사.
- **수정으로 바로 가지 말 것.** 캡쳐 후에만 fix 진입.
- 같은 stage에서 여러 번 실패하면 각각 별도 파일로.

### 5. HARNESS UPDATE

- 도출된 룰을 해당 `.claude/<module>.md`에 한 줄 추가.
- 측정 가능해야 함. "주의해라" 금지. "X 시 Y 사용" 형식.
- 어디 둘지 모호 → 새 모듈 만들지 사용자에게 확인.

### 6. FIX

- 추가된 룰에 따라 수정.
- 룰이 모호하면 룰 먼저 더 구체화 → 그 다음 코드.

### 7. TEST 복귀

- pass까지 4~6 반복. 같은 실패가 3번 반복되면 작업 단위가 너무 커진 것 — 분할 필요.

## 자동화 훅 (적용 완료)

- **pre-commit** ([.husky/pre-commit](../.husky/pre-commit)): `lint-staged` (prettier) → `pnpm lint` → `pnpm typecheck`.
- **pre-push** ([.husky/pre-push](../.husky/pre-push)): `pnpm test:unit` (단위 테스트). 통합 테스트는 Docker 의존이라 CI에서.
- **CI** ([.github/workflows/ci.yml](../.github/workflows/ci.yml)): `pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm typecheck` → `pnpm test` (통합 포함).
  - push/PR to `main`에서 트리거.
  - 같은 ref에서 새 push 시 이전 실행 자동 취소.
  - main 브랜치 보호 룰로 CI 그린 강제 권장 (GitHub UI에서 설정).
- 훅·CI 우회(`--no-verify`, GitHub admin override) 금지. 정 필요하면 별 branch + 사후 검증.
- PR 생성 직후 `gh pr checks --watch`는 체크 등록 전이면 "no checks reported"로 즉시 exit 0 — 생성과 감시·머지를 한 체인에 묶지 말고 `gh pr merge --auto` 사용.
- 실패 캡처는 **사람이 작성**. AI가 대신 채우면 이해 누락 위험.

## Stage 종료 체크리스트

- [ ] 모든 테스트 통과
- [ ] 새 코드 경로에 테스트 추가됨
- [ ] failures/ 에 이번 stage 실패가 모두 캡쳐됨
- [ ] 도출 룰이 모두 `.claude/<module>.md` 에 반영됨
- [ ] 룰 변경이 있으면 PR body에 "왜 추가" 명시

## 사이클 위반 금지

- "급해서 테스트 스킵" → 금지. 핫픽스 브랜치 + 사후 테스트로 분리.
- "사소해서 룰 안 추가" → 금지. 같은 실수 두 번 보이면 그때 추가는 늦음.
- "실패가 너무 많아 캡쳐 못 함" → 작업 단위가 큰 것. 분할.

## 회고 (월 1회)

- `.claude/failures/` 훑고 패턴 추출.
- 3회 이상 반복된 패턴 → 룰만으로 못 막는 것. 자동화 후보 (린트룰/타입가드/CI check).
- 더 이상 안 일어나는 룰은 삭제 — `.claude/*` 다이어트.
