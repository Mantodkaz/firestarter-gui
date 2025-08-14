import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface AuthTokens {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number; // seconds
  expires_at?: string; // ISO
  csrf_token?: string;
}

export interface SavedCredentials {
  user_id: string;
  user_app_key: string;
  auth_tokens?: AuthTokens;
  username?: string;
}

interface AuthContextType {
  credentials: SavedCredentials | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  hasJWT: boolean;
  login: (credentials: SavedCredentials) => Promise<void>;
  logout: () => void;
  loadCredentials: () => Promise<void>;
  updateCredentials: (credentials: SavedCredentials) => Promise<void>;
  deleteAccountData: (userId: string) => Promise<void>;
  listSavedUsers: () => Promise<SavedCredentials[]>;
  getUserApiConfig: (userId: string) => Promise<any>;
  getValidAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};

interface AuthProviderProps { children: React.ReactNode }

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [credentials, setCredentials] = useState<SavedCredentials | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const isAuthenticated = !!credentials;
  const hasJWT = !!credentials?.auth_tokens;

  const loadCredentials = useCallback(async () => {
    setIsLoading(true);
    try {
      const loaded = await invoke<SavedCredentials | null>('load_credentials');
      if (loaded && typeof loaded === 'object' && 'user_id' in loaded) {
        setCredentials(loaded);
        console.log('✅ Credentials loaded:', loaded.user_id);
      } else {
        setCredentials(null);
        console.log('ℹ️ No credentials found');
      }
    } catch (err) {
      console.error('Failed to load credentials:', err);
      setCredentials(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const persistCredentials = useCallback(async (next: SavedCredentials) => {
    await invoke('save_credentials', { credentials: next });
    setCredentials(next);
  }, []);

  const updateCredentials = useCallback(async (next: SavedCredentials) => {
    try {
      await persistCredentials(next);
      console.log('✅ Credentials updated');
    } catch (err) {
      console.error('❌ Failed to update credentials:', err);
      throw err;
    }
  }, [persistCredentials]);

  const login = useCallback(async (next: SavedCredentials) => {
    try {
      await persistCredentials(next);
      console.log('✅ Logged in:', {
        user_id: next.user_id.slice(0, 8) + '...',
        username: next.username,
        hasJWT: !!next.auth_tokens,
      });
    } catch (err) {
      console.error('❌ Failed to save credentials during login:', err);
      throw err;
    }
  }, [persistCredentials]);

  const logout = useCallback(() => {
    setCredentials(null);
    console.log('✅ Logged out (local state cleared)');
  }, []);

  const deleteAccountData = useCallback(async (userId: string) => {
    try {
      await invoke('clear_credentials', { user_id: userId });
      if (credentials?.user_id === userId) setCredentials(null);
      console.log('✅ Account data deleted for:', userId);
    } catch (err) {
      console.error('❌ Failed to delete account data:', err);
      throw err;
    }
  }, [credentials]);

  const listSavedUsers = useCallback(async (): Promise<SavedCredentials[]> => {
    try {
      const users = await invoke<SavedCredentials[]>('list_saved_users');
      return Array.isArray(users) ? users : [];
    } catch (err) {
      console.error('❌ Failed to list saved users:', err);
      return [];
    }
  }, []);

  const getUserApiConfig = useCallback(async () => {
    try {
      return await invoke('get_api_config');
    } catch {
      return null;
    }
  }, []);

  // --- refresh loop ----------------------------------------------------
  const msUntilExpiry = useCallback((creds: SavedCredentials | null) => {
    const iso = creds?.auth_tokens?.expires_at;
    if (!iso) return Number.POSITIVE_INFINITY;
    const exp = Date.parse(iso);
    return exp - Date.now();
  }, []);

  useEffect(() => {
    // check every 30s refresh if < 2 minutes remaining
    const interval = setInterval(async () => {
      try {
        if (!credentials?.auth_tokens?.access_token) return;
        const msLeft = msUntilExpiry(credentials);
        if (msLeft <= 2 * 60 * 1000) {
          await invoke('refresh_token');
          await loadCredentials();
          console.log('[Auth] token refreshed via background loop');
        }
      } catch (err) {
        console.warn('[Auth] background refresh failed:', err);
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [credentials?.auth_tokens?.access_token, msUntilExpiry, loadCredentials]);

  // --- get a valid (fresh) access token ----------------------------
  const getValidAccessToken = useCallback(async (): Promise<string | null> => {
    const current = credentials?.auth_tokens?.access_token ?? null;
    if (!current) return null;

    const msLeft = msUntilExpiry(credentials);
    if (msLeft > 2 * 60 * 1000) return current; // good enough

    try {
      await invoke('refresh_token');
      await loadCredentials();
      const users = await invoke<SavedCredentials[]>('list_saved_users');
      const me = users.find((u) => u.user_id === credentials?.user_id);
      return me?.auth_tokens?.access_token ?? null;
    } catch (err) {
      return null;
    }
  }, [credentials, msUntilExpiry, loadCredentials]);

  const value = useMemo<AuthContextType>(() => ({
    credentials,
    isLoading,
    isAuthenticated,
    hasJWT,
    login,
    logout,
    loadCredentials,
    updateCredentials,
    deleteAccountData,
    listSavedUsers,
    getUserApiConfig,
    getValidAccessToken,
  }), [
    credentials,
    isLoading,
    isAuthenticated,
    hasJWT,
    login,
    logout,
    loadCredentials,
    updateCredentials,
    deleteAccountData,
    listSavedUsers,
    getUserApiConfig,
    getValidAccessToken,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
