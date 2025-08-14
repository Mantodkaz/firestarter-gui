import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ep } from '../shared/api/endpoints';

interface SavedCredentials {
  user_id: string;
  user_app_key: string;
  auth_tokens?: {
    access_token: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: number; // seconds
    expires_at?: string; // ISO string
  };
  username?: string;
}

interface UserSelectorProps {
  onUserSelect: (credentials: SavedCredentials) => void;
  onCancel: () => void;
  onLoginRequired: (credentials: SavedCredentials) => void;
}

export const UserSelector: React.FC<UserSelectorProps> = ({ onUserSelect, onCancel, onLoginRequired }) => {
  const { listSavedUsers } = useAuth();

  const [users, setUsers] = useState<SavedCredentials[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // memoize refresh endpoint
  const refreshUrl = useMemo(() => ep('auth_refresh'), []);

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const saved = await listSavedUsers();
      setUsers(Array.isArray(saved) ? saved : []);
    } catch (e) {
      console.error('Failed to load saved users:', e);
      setError('Failed to load saved accounts');
    } finally {
      setIsLoading(false);
    }
  }, [listSavedUsers]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const tryRefresh = useCallback(
    async (user: SavedCredentials): Promise<SavedCredentials | null> => {
      if (!user.auth_tokens?.refresh_token) return null;
      try {
        const res = await fetch(refreshUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: user.auth_tokens.refresh_token }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        const expiresIn: number | undefined = data?.expires_in;
        const next: SavedCredentials = {
          ...user,
          auth_tokens: {
            ...user.auth_tokens,
            access_token: data.access_token,
            token_type: data.token_type ?? user.auth_tokens.token_type,
            expires_in: expiresIn,
            expires_at: typeof expiresIn === 'number' ? new Date(Date.now() + expiresIn * 1000).toISOString() : user.auth_tokens.expires_at,
            refresh_token: user.auth_tokens.refresh_token, // keep existing refresh token unless API returns a new one
          },
        };
        return next;
      } catch (e) {
        console.warn('Token refresh failed:', e);
        return null;
      }
    },
    [refreshUrl]
  );

  const performFreshLogin = useCallback(
    async (user: SavedCredentials) => {
      setIsAuthenticating(user.user_id);
      setError(null);
      try {
        // 1) Try silent refresh if have a refresh token
        const refreshed = await tryRefresh(user);
        if (refreshed) {
          onUserSelect(refreshed);
          return;
        }
        // 2) Otherwise, route to login flow for this user
        onLoginRequired(user);
      } catch (e) {
        console.error('Authentication error:', e);
        onLoginRequired(user);
      } finally {
        setIsAuthenticating(null);
      }
    },
    [onLoginRequired, onUserSelect, tryRefresh]
  );

  if (isLoading) {
    return (
      <div className="max-w-md mx-auto">
        <div className="card">
          <h2>Loading Saved Accounts...</h2>
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="max-w-md mx-auto">
        <div className="card">
          <h2>No Saved Accounts</h2>
          <p className="text-sm opacity-70 mb-4">No saved accounts found on this device.</p>
          <button onClick={onCancel} className="button">Continue to Login/Register</button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto">
      <div className="card">
        <h2>Select Account</h2>
        <p className="text-sm opacity-70 mb-4">Choose from saved accounts on this device:</p>

        {error && (
          <div className="error-message" style={{ marginBottom: 12 }}>{error}</div>
        )}

        <div className="space-y-3">
          {users.map((user) => (
            <div
              key={user.user_id}
              className={`p-3 border border-gray-600 rounded hover:border-gray-500 cursor-pointer transition-colors ${
                isAuthenticating === user.user_id ? 'opacity-50 pointer-events-none' : ''
              }`}
              onClick={() => performFreshLogin(user)}
            >
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-medium">{user.username || `User ${user.user_id.substring(0, 8)}...`}</div>
                  <div className="text-sm opacity-70">ID: {user.user_id.substring(0, 8)}...</div>
                  <div className="text-xs opacity-50">{user.auth_tokens ? '🔐 JWT Auth' : '🔑 Legacy Auth'}</div>
                </div>
                <div className="text-sm opacity-70">{isAuthenticating === user.user_id ? '⏳' : '→'}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 pt-4 border-t border-gray-600">
          <div className="auth-buttons">
            <button onClick={onCancel} className="button">Use Different Account</button>
          </div>
        </div>
      </div>
    </div>
  );
};
