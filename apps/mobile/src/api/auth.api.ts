import { api, setTokens } from './client';
import type { TokenPair, UserProfile } from './types';

interface AuthResponse<T> {
  data: T;
}

export async function register(email: string, password: string): Promise<UserProfile> {
  const res = await api<AuthResponse<UserProfile>>('/auth/register', {
    method: 'POST',
    body: { email, password },
    auth: false,
  });
  return res.data;
}

export async function login(email: string, password: string): Promise<TokenPair> {
  const res = await api<AuthResponse<TokenPair>>('/auth/login', {
    method: 'POST',
    body: { email, password },
    auth: false,
  });
  await setTokens(res.data);
  return res.data;
}

export async function getMe(): Promise<UserProfile> {
  const res = await api<AuthResponse<UserProfile>>('/users/me');
  return res.data;
}
