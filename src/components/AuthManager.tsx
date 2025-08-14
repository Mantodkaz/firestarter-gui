import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAuth } from '../contexts/AuthContext';
import { UserRegistration } from './UserRegistration';
import { UserLogin } from './UserLogin';
import { UserSelector } from './UserSelector';

type AuthMode = 'login' | 'register' | 'import' | 'select' | null;

interface JwtTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  expires_at?: string; // ISO
}

interface SavedCredentials {
  user_id: string;
  user_app_key: string;
  auth_tokens?: JwtTokens;
  username?: string;
}

export const AuthManager: React.FC = () => {
  const { credentials, isLoading, login, logout, listSavedUsers } = useAuth();

  // UI state
  const [authMode, setAuthMode] = useState<AuthMode>(null);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [importedCredentials, setImportedCredentials] = useState<SavedCredentials | null>(null);
  const [hasSavedUsers, setHasSavedUsers] = useState(false);
  const [checkingUsers, setCheckingUsers] = useState(true);
  const [userWantsSelector, setUserWantsSelector] = useState(true);
  const [loginSource, setLoginSource] = useState<'import' | 'selector' | null>(null);

  // Derived busy state
  const isBusy = useMemo(() => isLoading || checkingUsers, [isLoading, checkingUsers]);

  // Probe saved users at mount / when creds change
  useEffect(() => {
    const checkSavedUsers = async () => {
      try {
        const users = await listSavedUsers();
        setHasSavedUsers(users.length > 0);
        if (users.length > 0 && authMode === null && userWantsSelector) {
          setAuthMode('select');
        }
      } catch (err) {
        console.error('[AuthManager] listSavedUsers failed:', err);
      } finally {
        setCheckingUsers(false);
      }
    };

    if (!credentials) void checkSavedUsers();
    else setCheckingUsers(false);
  }, [credentials, listSavedUsers, authMode, userWantsSelector]);

  // From selector -> requires login/refresh
  const handleLoginRequired = useCallback((creds: SavedCredentials) => {
    setImportedCredentials(creds);
    setImportError('');
    setLoginSource('selector');
    setAuthMode('login');
  }, []);

  // Unified success -> persist via AuthContext
  const handleAuthSuccess = useCallback(
    async (newCredentials: SavedCredentials) => {
      try {
        await login(newCredentials);
        setAuthMode(null);
        setImportedCredentials(null);
        setLoginSource(null);
      } catch (error) {
        console.error('[AuthManager] saving credentials failed:', error);
        setAuthMode(null);
      }
    },
    [login]
  );

  // Import JSON -> save -> either done (valid token) / route to login
  const handleImportCredentials = useCallback(async () => {
    setImportError('');
    const raw = importText.trim();
    if (!raw) return setImportError('Please paste your credentials JSON');

    try {
      const parsed = JSON.parse(raw) as Partial<SavedCredentials>;
      if (!parsed.user_id || !parsed.user_app_key) {
        setImportError('Invalid credentials format. Missing user_id or user_app_key.');
        return;
      }

      const creds: SavedCredentials = {
        user_id: parsed.user_id,
        user_app_key: parsed.user_app_key,
        auth_tokens: parsed.auth_tokens as JwtTokens | undefined,
        username: parsed.username,
      };

      // Persist imported creds so selector/login sees it
      await invoke('save_credentials', { credentials: creds });

      // If JWT looks valid & not expired, short-circuit to success
      const exp = creds.auth_tokens?.expires_at ? Date.parse(creds.auth_tokens.expires_at) : 0;
      if (creds.auth_tokens?.access_token && exp && exp > Date.now()) {
        await handleAuthSuccess(creds);
        setImportText('');
        return;
      }

      // Drive user to login screen with prefill
      setImportedCredentials(creds);
      setImportText('');
      setLoginSource('import');
      setAuthMode('login');
    } catch (error: any) {
      if (error instanceof SyntaxError) setImportError('Invalid JSON format. Please check your credentials.');
      else {
        console.error('[AuthManager] import error:', error);
        setImportError(`Failed to import credentials: ${error?.message || String(error)}`);
      }
    }
  }, [importText, handleAuthSuccess]);

  // Busy screen
  if (isBusy) {
    return (
      <div className="max-w-md mx-auto">
        <div className="card">
          <h2>Loading...</h2>
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  // Authenticated summary
  if (credentials) {
    const hasJWT = !!credentials.auth_tokens;
    const tokenExpiry = credentials.auth_tokens?.expires_at
      ? new Date(credentials.auth_tokens.expires_at).toLocaleString()
      : null;

    return (
      <div className="max-w-md mx-auto">
        <div className="card">
          <h2>✅ Authentication Successful</h2>
          <div className="space-y-4">
            <div>
              <p><strong>User:</strong> {credentials.username || 'Unknown'}</p>
              <p><strong>User ID:</strong> {credentials.user_id.substring(0, 8)}...</p>
              <p><strong>Status:</strong> {hasJWT ? '🔐 JWT Active' : '🔑 Legacy Auth'}</p>
              {tokenExpiry && <p><strong>Token Expires:</strong> {tokenExpiry}</p>}
            </div>

            <div className="auth-buttons">
              <button onClick={logout} className="button">Logout</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Selector
  if (authMode === 'select') {
    return (
      <UserSelector
        onUserSelect={handleAuthSuccess}
        onCancel={() => { setUserWantsSelector(false); setAuthMode(null); }}
        onLoginRequired={handleLoginRequired}
      />
    );
  }

  // Register
  if (authMode === 'register') {
    return <UserRegistration onSuccess={handleAuthSuccess} onCancel={() => setAuthMode(null)} />;
  }

  // Login
  if (authMode === 'login') {
    const loginProps = importedCredentials
      ? {
          existingCredentials: importedCredentials,
          importMessage:
            loginSource === 'import'
              ? `✅ Credentials imported! Please login with username: ${importedCredentials.username || 'your username'}`
              : `🔐 Authentication needed for: ${importedCredentials.username || 'your account'}`,
        }
      : { existingCredentials: undefined };

    return (
      <UserLogin
        {...loginProps}
        onSuccess={handleAuthSuccess}
        onCancel={() => { setAuthMode(null); setImportedCredentials(null); setLoginSource(null); }}
      />
    );
  }

  // Import
  if (authMode === 'import') {
    return (
      <div className="max-w-md mx-auto">
        <div className="card">
          <h2>Import Credentials</h2>
          <p className="text-sm opacity-70 mb-4">Paste your exported credentials JSON below:</p>

          <div className="form-group">
            <label>Credentials JSON:</label>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder='{"user_id": "...", "user_app_key": "...", ...}'
              rows={6}
              style={{
                width: '100%',
                resize: 'vertical',
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                padding: '0.75rem',
                border: '1px solid #444',
                borderRadius: '4px',
                background: '#2a2a2a',
                color: '#e5e5e5',
              }}
            />
          </div>

          {importError && <div className="error-message">{importError}</div>}

          <div className="auth-buttons">
            <button onClick={() => setAuthMode(null)} className="button">Cancel</button>
            <button onClick={handleImportCredentials} className="button" disabled={!importText.trim()}>
              Import
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Landing chooser
  return (
    <div className="max-w-md mx-auto">
      <div className="card">
        <h2>Welcome to Firestarter</h2>
        <p className="text-sm opacity-70 mb-6">Choose how you'd like to get started:</p>

        <div className="space-y-3">
          {hasSavedUsers && (
            <button onClick={() => { setUserWantsSelector(true); setAuthMode('select'); }} className="button w-full">
              Select Saved Account
            </button>
          )}

          <button onClick={() => setAuthMode('register')} className="button w-full">Create Account</button>
          <button onClick={() => setAuthMode('import')} className="button w-full">Import Credentials</button>
          <button onClick={() => setAuthMode('login')} className="button w-full">Login</button>
        </div>
      </div>
    </div>
  );
};
