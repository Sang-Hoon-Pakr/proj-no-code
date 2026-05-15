# 테스트 전략

> 상세 규칙(어떤 mock 금지, 커버리지 기준 등)은 [.claude/testing-rules.md](../.claude/testing-rules.md) 참조.
> 이 문서는 **무엇을 어디서 테스트하는가**의 분류를 정의한다.

## 피라미드 (역방향 권장)

일반 피라미드(unit 多 → e2e 少) 대신 **메신저 특성상 통합 비중을 높게** 가져간다.

- **unit 40%**: 순수 함수, 도메인 로직, 유틸.
- **integration 50%**: DB·Redis·WS·HTTP 묶음 검증. **메신저는 여기서 대부분의 버그를 잡는다.**
- **e2e 10%**: 사용자 시나리오 전체 흐름.

## 디렉토리 분류 기준

| 분류            | 위치                 | 외부 의존                                   | 실행 시간 | 예시                                                 |
| --------------- | -------------------- | ------------------------------------------- | --------- | ---------------------------------------------------- |
| **unit**        | `tests/unit/`        | 없음 (pure function)                        | < 50ms    | 메시지 길이 검증, 시간 포맷, 토큰 파싱               |
| **integration** | `tests/integration/` | Testcontainers (PG/Redis), 같은 프로세스 WS | < 5s      | 메시지 전송 idempotency, presence TTL, 재연결 동기화 |
| **e2e**         | `tests/e2e/`         | 실제 빌드된 앱 + 서버 + DB                  | < 30s     | 로그인→방생성→메시지전송→읽음→로그아웃               |

## 필수 통합 시나리오 (메신저 핵심)

이 시나리오는 누락되면 PR 머지 차단:

1. `message-idempotency.spec.ts` — 같은 clientMessageId 2회 전송 시 DB에 1건.
2. `ws-reconnect-sync.spec.ts` — 연결 끊고 메시지 N개 발생 → 재연결 후 `messages:since`로 N개 전부 수신.
3. `block-relationship.spec.ts` — A가 B 차단 시 B의 메시지가 A에 미도달.
4. `read-receipt-group.spec.ts` — 그룹방 안읽음 카운트가 `lastReadSeq` 기반으로 정확.
5. `presence-grace.spec.ts` — 연결 끊김 60s 내 재연결 시 친구에게 offline broadcast 없음.
6. `push-token-rotation.spec.ts` — 구토큰 무효화 후 신토큰만 사용.
7. `rate-limit.spec.ts` — 초당 5건 초과 시 429.

## 필수 E2E 시나리오

1. **온보딩**: 가입 → 전화번호 인증 → 프로필 설정 → 친구 추천.
2. **1:1 채팅**: 친구 추가 → 메시지 송수신 → 이미지 첨부 → 읽음 표시.
3. **그룹채팅**: 방 생성 → 멤버 초대 → 메시지 → 멤버 퇴장 → 방 삭제.
4. **오프라인 복구**: 비행기모드 진입 → 메시지 작성(sending) → 복귀 → 자동 전송.
5. **푸시 → 진입**: 백그라운드에서 푸시 수신 → 탭 → 해당 메시지로 deeplink.

## 실행 (스캐폴딩 완료 후 채움)

```bash
# 전체
TBD
# unit만
TBD
# integration (Docker 필요)
TBD
# e2e (시뮬레이터/에뮬레이터 필요)
TBD
```

## 점검

- [ ] 신규 기능 PR에 통합 테스트가 1개 이상 있는가
- [ ] mock 사용 시 인터페이스 경계인지 (DB/Redis/WS mock 발견 시 PR 거절)
- [ ] flaky test 발견 시 즉시 격리 후 원인 추적
