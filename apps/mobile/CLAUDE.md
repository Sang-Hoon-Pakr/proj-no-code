# apps/mobile — React Native 앱 가드레일

> 루트 [CLAUDE.md](../../CLAUDE.md)와 `.claude/mobile-rules.md`가 먼저 적용된다. 여기는 **앱 한정** 규칙.

## 명령어

- 개발 서버 (Metro): `pnpm dev`
- iOS 실행: `pnpm ios`
- Android 실행: `pnpm android`
- 테스트: `pnpm test`
- E2E (Detox): `pnpm test:e2e`
- 빌드 (iOS): `pnpm build:ios`
- 빌드 (Android): `pnpm build:android`
- 캐시 클린: `pnpm clean` (Metro + iOS Pods + Android gradle)

## 앱 한정 invariants

- **컴포넌트는 hooks만 사용.** 클래스 컴포넌트 금지.
- **인라인 익명 함수를 prop으로 매번 새로 만들지 않는다.** `useCallback`.
- **화면 컴포넌트는 데이터 페칭 직접 X.** `screens/<name>/use<Name>.ts` hook에 분리.
- **`StyleSheet.create()` 사용.** 인라인 style 금지 (성능 + 일관성).
- **Image는 `react-native-fast-image`로 통일.** RN 기본 `Image` 금지 (캐시 일관성).
- **네비게이션 파라미터는 typed.** `RootStackParamList` 정의 + `NativeStackScreenProps`.

## 디렉토리

- `src/screens/<name>/` — 화면 (Container + UI + hook).
- `src/components/` — 재사용 컴포넌트 (presentational).
- `src/api/` — 서버 통신 (REST + WS).
- `src/store/` — Zustand 슬라이스.
- `src/db/` — 로컬 SQLite (WatermelonDB).
- `src/lib/` — 유틸 / hooks / 상수.

## 빌드 / 환경

- iOS: Xcode 15+, CocoaPods.
- Android: JDK 17, NDK 26.
- 환경 분리: `.env.development`, `.env.staging`, `.env.production`. `react-native-config` 사용.

## 디버깅

- 프로덕션 빌드에 `console.log` 금지. `__DEV__` 가드 필수.
- Reactotron 사용 시 dev 빌드 한정. 프로덕션 코드에 import 금지.
