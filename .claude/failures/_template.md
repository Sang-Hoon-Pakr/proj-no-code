---
date: YYYY-MM-DD
stage: <어떤 작업 중이었나>
module: <영향받은 .claude/ 모듈, 예: realtime-rules>
severity: low | medium | high
status: captured | rule-added | fixed | archived
---

## 무엇을 시도했나

(1~3줄. 어떤 기능/변경이었는지)

## 무엇이 실패했나

- **증상/에러:**
- **재현 절차:**
  1.
  2.
- **영향 범위:** (어떤 사용자/시나리오)

## 왜 실패했나 (근본 원인)

(추측 X, 분석 O. 모르겠으면 "TBD" 명시 후 디버깅 계속)

## 어떤 룰이 있었으면 막을 수 있었나

- **추가할 룰 (한 줄, 측정 가능):**
  > 예: "WebSocket 재연결은 exponential backoff 1s → 30s, 즉시 재연결 금지"
- **추가할 파일:** `.claude/<file>.md`
- **추가가 어렵다면 자동화로 가능한가:**
  - [ ] 린트 룰
  - [ ] 타입 가드
  - [ ] CI check
  - [ ] runtime assertion

## 후속 조치

- [ ] 룰 추가 (`.claude/...`)
- [ ] 코드 수정
- [ ] 회귀 테스트 추가
- [ ] 같은 패턴 다른 곳에도 있나 grep 확인
