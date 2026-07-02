import { create } from 'zustand';
import type { UserProfile } from '../api/types';
import { clearTokens, getAccessToken, setUnauthorizedHandler } from '../api/client';
import { getMe, login as loginApi } from '../api/auth.api';

interface AuthState {
  user: UserProfile | null;
  status: 'idle' | 'loading' | 'authenticated' | 'unauthenticated';
  hydrate: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => {
  setUnauthorizedHandler(() => {
    set({ user: null, status: 'unauthenticated' });
  });

  return {
    user: null,
    status: 'idle',

    async hydrate() {
      set({ status: 'loading' });
      const token = await getAccessToken();
      if (!token) {
        set({ status: 'unauthenticated' });
        return;
      }
      try {
        const user = await getMe();
        set({ user, status: 'authenticated' });
      } catch {
        await clearTokens();
        set({ status: 'unauthenticated' });
      }
    },

    async login(email, password) {
      set({ status: 'loading' });
      try {
        await loginApi(email, password);
        const user = await getMe();
        set({ user, status: 'authenticated' });
      } catch (e) {
        set({ status: 'unauthenticated' });
        throw e;
      }
    },

    async logout() {
      await clearTokens();
      set({ user: null, status: 'unauthenticated' });
    },
  };
});
