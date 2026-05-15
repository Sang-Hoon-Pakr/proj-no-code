import Constants from 'expo-constants';

interface AppConfig {
  apiUrl: string;
  wsUrl: string;
}

// app.json의 extra 필드에서 읽음. EXPO_PUBLIC_* 환경변수로 오버라이드 가능.
const extra = (Constants.expoConfig?.extra ?? {}) as Partial<AppConfig>;

export const config: AppConfig = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? extra.apiUrl ?? 'http://localhost:3000/api/v1',
  wsUrl: process.env.EXPO_PUBLIC_WS_URL ?? extra.wsUrl ?? 'http://localhost:3000',
};
