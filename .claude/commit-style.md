# commit-style — Git / PR 규칙

## 커밋 메시지

- **Conventional Commits** 형식: `<type>(<scope>): <subject>`.
- type: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `build`, `ci`.
- scope: `app`, `server`, `db`, `ws`, `auth`, `room`, `message`, `push` 등.
- subject는 한국어/영어 모두 허용. 50자 이내. 마침표 X.
- breaking change는 `feat(api)!:` 또는 본문에 `BREAKING CHANGE:` 라인.

예시

```
feat(message): 메시지 idempotency를 위한 clientMessageId 추가
fix(ws): 백그라운드 진입 시 재연결 무한루프 해결
refactor(auth)!: refresh token rotation 강제, 기존 토큰 무효화
```

## 브랜치

- `main` 보호. 직접 푸시 금지. PR 필수.
- 작업 브랜치: `<type>/<short-name>` (`feat/group-chat`, `fix/ws-reconnect`).
- 머지 전략: **squash merge**. 커밋 히스토리는 PR title이 됨.

## PR

- title은 conventional commits 형식 그대로.
- body 템플릿:
  - 무엇을 (1~2줄)
  - 왜 (1~2줄)
  - 어떻게 검증 (체크리스트)
  - 스크린샷/영상 (UI 변경 시)
- CI 통과 + 1명 이상 리뷰 + 모든 코멘트 해결 후 머지.

## CLAUDE.md 변경

- `.claude/*.md` 또는 루트 `CLAUDE.md` 변경 PR은 **반드시 "왜 추가하는지" 본문에 명시**.
- 무분별한 룰 추가 방지. 실수 사례를 인용하면 더 좋음.
- 룰 삭제 PR은 환영. 더 이상 안 일어나는 실수는 빼는 게 맞다.
