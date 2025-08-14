import React, { useCallback, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface AuthTokens {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  expires_at?: string;
  csrf_token?: string;
}

interface SavedCredentials {
  user_id: string;
  user_app_key: string;
  auth_tokens?: AuthTokens;
  username?: string;
}

interface UserLoginProps {
  onSuccess: (credentials: SavedCredentials) => void;
  onCancel: () => void;
  existingCredentials?: SavedCredentials;
  importMessage?: string;
}

export const UserLogin: React.FC<UserLoginProps> = ({ onSuccess, onCancel, existingCredentials, importMessage }) => {
  const [username, setUsername] = useState(existingCredentials?.username ?? '');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const canSubmit = useMemo(() => username.trim().length > 0 && password.trim().length > 0 && !isLoading, [username, password, isLoading]);

  const resolveBaseCredentials = useCallback(async (uname: string): Promise<SavedCredentials | null> => {
    if (existingCredentials) return existingCredentials;
    try {
      const saved = await invoke<SavedCredentials[]>('list_saved_users');
      const found = saved.find((u) => u.username?.toLowerCase() === uname.toLowerCase());
      return found ?? null;
    } catch (e) {
      console.error('[Login] list_saved_users failed');
      return null;
    }
  }, [existingCredentials]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const uname = username.trim();
    const pwd = password; // keep exact

    if (!uname || !pwd) {
      setError('Username and password are required');
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      // Ask backend to log in and return JWT tokens as JSON string
      const tokenJson = await invoke<string>('user_login', { username: uname, password: pwd });
      let tokens: AuthTokens | null = null;
      try {
        tokens = JSON.parse(tokenJson) as AuthTokens;
      } catch {
        throw new Error('Invalid token payload from backend');
      }

      // Find base credentials (user_id, app_key)
      const base = await resolveBaseCredentials(uname);
      if (!base) {
        setError(`No local account found for "${uname}". Please register or import credentials first.`);
        return;
      }

      const merged: SavedCredentials = { ...base, username: uname, auth_tokens: tokens };

      // Persist
      await invoke('save_credentials', { credentials: merged });
      onSuccess(merged);
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err?.message || String(err);
      // Normalize a few common cases without leaking backend text
      if (/locked/i.test(msg)) setError('Account locked due to too many attempts. Try later or contact support.');
      else if (/too many/i.test(msg)) setError('Too many login attempts. Please wait a moment and try again.');
      else setError(`Login failed: ${msg}`);
    } finally {
      setIsLoading(false);
    }
  }, [username, password, onSuccess, resolveBaseCredentials]);

  return (
    <div className="max-w-md mx-auto">
      <div className="card">
        <h2>Login</h2>

        {importMessage && (
          <div
            style={{
              padding: '0.75rem',
              borderRadius: 4,
              marginBottom: '1rem',
              background: '#d4edda',
              color: '#155724',
              border: '1px solid #c3e6cb',
            }}
          >
            {importMessage}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={existingCredentials?.username ? `Login as: ${existingCredentials.username}` : 'Enter your username'}
              disabled={isLoading}
              autoComplete="username"
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              disabled={isLoading}
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div style={{ color: '#ff6b6b', fontSize: '0.875rem', marginBottom: '1rem' }}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button type="button" onClick={onCancel} className="button" style={{ flex: 1 }} disabled={isLoading}>
              Cancel
            </button>
            <button type="submit" className="button" style={{ flex: 1 }} disabled={!canSubmit}>
              {isLoading ? 'Logging in...' : 'Login'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
