import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  expires_at?: string; // ISO string format
  csrf_token?: string;
}

interface SavedCredentials {
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
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [credentials, setCredentials] = useState<SavedCredentials | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const isAuthenticated = credentials !== null;
  const hasJWT = credentials?.auth_tokens !== undefined;
  const loadCredentials = useCallback(async () => {
    setIsLoading(true);
    try {
      // try load credentials
      const loaded = await invoke('load_credentials');
      if (loaded && typeof loaded === 'object' && 'user_id' in loaded) {
        setCredentials(loaded as SavedCredentials);
        console.log('✅ Credentials loaded from file:', loaded.user_id);
      } else {
        setCredentials(null);
        console.log('⚠️ No credentials found in file');
      }
    } catch (error) {
      console.error('Failed to load credentials:', error);
      setCredentials(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateCredentials = useCallback(async (newCredentials: SavedCredentials) => {
    try {
      await invoke('save_credentials', { credentials: newCredentials });
      setCredentials(newCredentials);
      console.log('✅ Credentials updated and saved');
    } catch (error) {
      console.error('❌ Failed to save credentials:', error);
      throw error;
    }
  }, []);

  const login = useCallback(async (newCredentials: SavedCredentials) => {
    try {
      await invoke('save_credentials', { credentials: newCredentials });
      setCredentials(newCredentials);
      console.log('✅ User logged in and saved:', {
        user_id: newCredentials.user_id.substring(0, 8) + '...',
        username: newCredentials.username,
        hasJWT: !!newCredentials.auth_tokens,
      });
    } catch (error) {
      console.error('❌ Failed to save credentials during login:', error);
      throw error;
    }
  }, []);

  const logout = useCallback(() => {
    setCredentials(null);
    console.log('✅ User logged out (credentials remain saved)');
  }, []);

  const deleteAccountData = useCallback(async (userId: string) => {
    try {
      await invoke('clear_credentials', { userId });
      if (credentials?.user_id === userId) {
        setCredentials(null);
      }
      console.log('✅ Account data deleted for user:', userId);
    } catch (error) {
      console.error('❌ Failed to delete account data:', error);
      throw error;
    }
  }, [credentials]);

  const listSavedUsers = useCallback(async (): Promise<SavedCredentials[]> => {
    try {
      const users = await invoke<SavedCredentials[]>('list_saved_users');
      return users;
    } catch (error) {
      console.error('❌ Failed to list saved users:', error);
      return [];
    }
  }, []);

  const getUserApiConfig = useCallback(async (userId: string): Promise<any> => {
    try {
      const config = await invoke('get_user_api_config', { userId });
      return config;
    } catch (error) {
      console.error('❌ Failed to get user API config:', error);
      return null;
    }
  }, []);

  // Auto-refresh JWT credentials (bug fixes)
  useEffect(() => {
    if (!credentials?.auth_tokens?.access_token || !credentials?.auth_tokens?.expires_at) return;
    const interval = setInterval(async () => {
      try {
        const expiresAt = Date.parse(credentials.auth_tokens!.expires_at!);
        const now = Date.now();
        // 2 minutes
        if (expiresAt - now < 2 * 60 * 1000) {
          await invoke('refresh_token');
          let loaded = false;
          let retries = 0;
          let lastCreds: any = null;
          while (!loaded && retries < 5) {
            await new Promise(res => setTimeout(res, 200 + 200 * retries));
            await loadCredentials();
            lastCreds = await invoke('load_credentials');
            // Type guard: check if lastCreds is an object and has auth_tokens
            if (
              lastCreds &&
              typeof lastCreds === 'object' &&
              'auth_tokens' in lastCreds &&
              lastCreds.auth_tokens &&
              typeof lastCreds.auth_tokens === 'object' &&
              'access_token' in lastCreds.auth_tokens &&
              lastCreds.auth_tokens.access_token
            ) {
              loaded = true;
              break;
            }
            retries++;
          }
          if (loaded) {
            console.log(`[Auth] Token auto-refreshed and credentials loaded (retry ${retries})`);
          } else {
            console.warn('[Auth] Token refreshed but failed to load credentials after retry');
          }
        }
      } catch (e) {
        console.warn('[Auth] Auto-refresh token failed:', e);
      }
    }, 30 * 1000); // check every 30 seconds
    return () => clearInterval(interval);
  }, [credentials?.auth_tokens?.access_token, credentials?.auth_tokens?.expires_at, loadCredentials]);

  // Get valid access token
  const getValidAccessToken = React.useCallback(async (): Promise<string | null> => {
    if (!credentials?.auth_tokens?.access_token) return null;
    const expiresAtStr = credentials.auth_tokens.expires_at;
    if (!expiresAtStr) return credentials.auth_tokens.access_token;
    const expiresAt = Date.parse(expiresAtStr);
    const now = Date.now();
    if (expiresAt - now < 2 * 60 * 1000) {
      try {
        await invoke('refresh_token');
        await loadCredentials();
        const users = await invoke<SavedCredentials[]>('list_saved_users');
        const currentUser = users.find(u => u.user_id === credentials?.user_id);
        if (currentUser?.auth_tokens?.access_token) {
          return currentUser.auth_tokens.access_token;
        } else {
          return null;
        }
      } catch {
        return null;
      }
    }
    return credentials.auth_tokens.access_token;
  }, [credentials, loadCredentials]);

  const value: AuthContextType = {
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
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
