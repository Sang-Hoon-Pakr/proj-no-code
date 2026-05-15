# mobile-rules — React Native 앱 invariants

## 네트워크 / 오프라인

- 모든 API 호출은 오프라인 가능성을 가정. 실패 시 로컬 큐 저장 후 재시도.
- 메시지는 **SQLite(WatermelonDB or op-sqlite)에 먼저 쓰고 UI 반영 → 서버 전송**.
- `NetInfo`로 연결 상태 감지. offline → online 전환 시 동기화 트리거.

## 백그라운드 / 배터리

- 백그라운드에서 WebSocket 유지 시도 금지. FCM/APNs로 wake-up.
- 위치/모션 API 사용 금지 (메신저 본질 외).
- 폴링 금지. 서버 푸시 또는 사용자 액션으로 데이터 갱신.

## 메모리

- 메시지 리스트는 `FlatList` + `windowSize` 조정. 모든 메시지 메모리 로드 금지.
- 이미지는 `react-native-fast-image` 사용. 캐싱 정책 명시 (`immutable` for static, `web` for user content).
- 메시지 1만개 넘는 방은 pagination + virtualization 필수.

## 한국어 / 입력

- TextInput에 `autoCorrect={false}`, `autoCapitalize="none"` (메시지 입력창에 한해).
- 이모지 + 한글 조합 시 cursor 위치 버그 — `defaultValue` 대신 controlled로 처리.
- 음성 인식/자판 변환 중 메시지 전송은 입력 완료(IME composition end) 후에만.

## 푸시 알림

- 토큰은 로그인 직후 + 24시간마다 + 백그라운드 → foreground 전환 시 서버에 갱신.
- 알림 페이로드에 메시지 본문 포함 금지 (보안). `roomId`, `senderId`, `preview="새 메시지"`만.
- 알림 탭 시 딥링크는 `/rooms/:id?messageId=...`로 specific 메시지로 이동.

## 권한 (iOS/Android)

- 권한 요청은 사용자가 그 기능을 누른 직후에만. 앱 시작 시 한꺼번에 요청 금지.
- 권한 거부 시 fallback UI 제공. 설정 앱으로 보내는 deeplink 포함.

## 보안

- Keychain(iOS) / Keystore(Android)로 refresh token 저장. AsyncStorage에 토큰 저장 금지.
- 스크린샷 차단 — 1:1방은 옵션, 비밀채팅은 강제 (`react-native-prevent-screenshot`).
- jailbreak/root 감지 후 민감 기능 제한 (`jail-monkey`).

## 빌드

- iOS: bitcode 비활성 (Xcode 14+ 표준).
- Android: Hermes 엔진 사용, ABI split 활성.
- 프로덕션 빌드에서 `__DEV__` 가드 코드 제거 확인.
