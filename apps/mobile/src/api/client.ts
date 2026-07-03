import * as SecureStore from 'expo-secure-store';
import { config } from '../config';
import type { ProblemDetail, TokenPair } from './types';

// security-rules.md / mobile-rules.md: 토큰은 Keychain(iOS)/Keystore(Android).
// AsyncStorage 저장 금지 — expo-secure-store 사용.
const ACCESS_TOKEN_KEY = 'auth.accessToken';
const REFRESH_TOKEN_KEY = 'auth.refreshToken';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly problem: ProblemDetail | null,
  ) {
    super(`api error ${status} ${code}`);
    this.name = 'ApiError';
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(h: () => void): void {
  onUnauthorized = h;
}

export async function setTokens(tokens: TokenPair): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken),
  ]);
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
  ]);
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  auth?: boolean; // default true
}

async function doFetch<T>(path: string, options: RequestOptions): Promise<T> {
  const url = new URL(`${config.apiUrl}${path}`);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.auth !== false) {
    const token = await getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url.toString(), {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const problem = data as ProblemDetail | null;
    const code = problem?.detail?.code ?? 'HTTP_ERROR';
    throw new ApiError(res.status, code, problem);
  }
  return data as T;
}

// refresh rotation 1회 시도. REST 401 경로와 WS connect_error 경로가 공유.
// 서버 거부(ApiError)면 세션 종료, 네트워크 에러면 토큰 유지 (재시도 여지).
export async function refreshTokens(): Promise<boolean> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) {
    onUnauthorized?.();
    return false;
  }
  try {
    const tokens = await doFetch<{ data: TokenPair }>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
      auth: false,
    });
    await setTokens(tokens.data);
    return true;
  } catch (e) {
    if (e instanceof ApiError) {
      await clearTokens();
      onUnauthorized?.();
    }
    return false;
  }
}

// 401 시 refresh 1회 시도 후 재요청. refresh도 거부되면 onUnauthorized 콜백 → 로그인 화면 이동.
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await doFetch<T>(path, options);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && options.auth !== false) {
      if (await refreshTokens()) {
        return await doFetch<T>(path, options);
      }
    }
    throw e;
  }
}
