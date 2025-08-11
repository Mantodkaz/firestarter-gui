import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAuth } from '../contexts/AuthContext';
import { UserRegistration } from './UserRegistration';
import { UserLogin } from './UserLogin';
import { UserSelector } from './UserSelector';

type AuthMode = 'login' | 'register' | 'import' | 'select' | null;

interface SavedCredentials {
  user_id: string;
  user_app_key: string;
  auth_tokens?: any;
  username?: string;
}

export const AuthManager: React.FC = () => {
  const { credentials, isLoading, login, logout, listSavedUsers } = useAuth();
  const [authMode, setAuthMode] = useState<AuthMode>(null);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [importedCredentials, setImportedCredentials] = useState<SavedCredentials | null>(null);
  const [hasSavedUsers, setHasSavedUsers] = useState(false);
  const [checkingUsers, setCheckingUsers] = useState(true);
  const [userWantsSelector, setUserWantsSelector] = useState(true);
  const [loginSource, setLoginSource] = useState<'import' | 'selector' | null>(null);

  // Check for saved users on component mount
  useEffect(() => {
    const checkSavedUsers = async () => {
      try {
        const users = await listSavedUsers();
        setHasSavedUsers(users.length > 0);
        
        // If there are saved users and no current auth mode, show selector only if user wants it
        if (users.length > 0 && authMode === null && userWantsSelector) {
          setAuthMode('select');
        }
      } catch (error) {
        console.error('Failed to check saved users:', error);
      } finally {
        setCheckingUsers(false);
      }
    };

    if (!credentials) {
      checkSavedUsers();
    } else {
      setCheckingUsers(false);
    }
  }, [credentials, listSavedUsers, authMode, userWantsSelector]);

  const handleLoginRequired = (credentials: SavedCredentials) => {
    // Set imported credentials for auto-filling username
    setImportedCredentials(credentials);
    // Clear any existing import error since this is from selector
    setImportError('');
    setLoginSource('selector');
    setAuthMode('login');
  };

  const handleAuthSuccess = async (newCredentials: SavedCredentials) => {
    try {
      await login(newCredentials);
      setAuthMode(null);
    } catch (error) {
      console.error('❌ Failed to save credentials:', error);
      setAuthMode(null);
    }
  };

  const handleImportCredentials = async () => {
    setImportError('');
    
    if (!importText.trim()) {
      setImportError('Please paste your credentials JSON');
      return;
    }

    try {
      const parsed = JSON.parse(importText.trim());
      
      if (!parsed.user_id || !parsed.user_app_key) {
        setImportError('Invalid credentials format. Missing user_id or user_app_key.');
        return;
      }

      const credentials: SavedCredentials = {
        user_id: parsed.user_id,
        user_app_key: parsed.user_app_key,
        auth_tokens: parsed.auth_tokens,
        username: parsed.username,
      };

      // Save credentials to backend storage
      console.log('💾 Saving imported credentials to backend...');
      await invoke('save_credentials', { credentials });
      console.log('✅ Credentials saved successfully');

      // Check if imported credentials have valid JWT tokens
      const hasValidTokens = credentials.auth_tokens && 
        credentials.auth_tokens.access_token && 
        credentials.auth_tokens.expires_at;
      
      if (hasValidTokens) {
        // Check if tokens are not expired
        const expiryTime = new Date(credentials.auth_tokens!.expires_at!).getTime();
        const currentTime = Date.now();
        
        if (expiryTime > currentTime) {
          // Tokens are still valid, proceed directly to success
          console.log('✅ Imported credentials have valid JWT tokens');
          await handleAuthSuccess(credentials);
          setImportText('');
          return;
        }
      }
      
      // Tokens are expired or missing, need to login
      setImportedCredentials(credentials);
      setImportText('');
      setImportError('');
      setLoginSource('import');
      setAuthMode('login');
    } catch (error) {
      if (error instanceof SyntaxError) {
        setImportError('Invalid JSON format. Please check your credentials.');
      } else {
        console.error('❌ Import error details:', error);
        const errorStr = typeof error === 'string' ? error : String(error);
        setImportError(`Failed to import credentials: ${errorStr}`);
      }
      console.error('❌ Import error:', error);
    }
  };

  if (isLoading || checkingUsers) {
    return (
      <div className="max-w-md mx-auto">
        <div className="card">
          <h2>Loading...</h2>
          <div className="loading-spinner"></div>
        </div>
      </div>
    );
  }

  // User is authenticated
  if (credentials) {
    const hasJWT = credentials.auth_tokens !== undefined;
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
              {tokenExpiry && (
                <p><strong>Token Expires:</strong> {tokenExpiry}</p>
              )}
            </div>
            
            <div className="auth-buttons">
              <button onClick={logout} className="button">
                Logout
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show user selector if there are saved users
  if (authMode === 'select') {
    return (
      <UserSelector
        onUserSelect={handleAuthSuccess}
        onCancel={() => {
          setUserWantsSelector(false);
          setAuthMode(null);
        }}
        onLoginRequired={handleLoginRequired}
      />
    );
  }

  // Show auth mode selection or specific auth form
  if (authMode === 'register') {
    return (
      <UserRegistration
        onSuccess={handleAuthSuccess}
        onCancel={() => setAuthMode(null)}
      />
    );
  }

  if (authMode === 'login') {
    const loginProps = importedCredentials 
      ? { 
          existingCredentials: importedCredentials,
          importMessage: loginSource === 'import' 
            ? `✅ Credentials imported! Please login with username: ${importedCredentials.username || 'your username'}`
            : `🔐 Authentication needed for: ${importedCredentials.username || 'your account'}`
        }
      : { existingCredentials: credentials || undefined };
      
    return (
      <UserLogin
        {...loginProps}
        onSuccess={handleAuthSuccess}
        onCancel={() => {
          setAuthMode(null);
          setImportedCredentials(null);
          setLoginSource(null);
        }}
      />
    );
  }

  if (authMode === 'import') {
    return (
      <div className="max-w-md mx-auto">
        <div className="card">
          <h2>Import Credentials</h2>
          <p className="text-sm opacity-70 mb-4">
            Paste your exported credentials JSON below:
          </p>

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
                color: '#e5e5e5'
              }}
            />
          </div>

          {importError && (
            <div className="error-message">
              {importError}
            </div>
          )}

          <div className="auth-buttons">
            <button
              onClick={() => setAuthMode(null)}
              className="button"
            >
              Cancel
            </button>
            <button
              onClick={handleImportCredentials}
              className="button"
              disabled={!importText.trim()}
            >
              Import
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show auth mode selection
  return (
    <div className="max-w-md mx-auto">
      <div className="card">
        <h2>Welcome to Firestarter</h2>
        <p className="text-sm opacity-70 mb-6">
          Choose how you'd like to get started:
        </p>

        <div className="space-y-3">
          {hasSavedUsers && (
            <button
              onClick={() => {
                setUserWantsSelector(true);
                setAuthMode('select');
              }}
              className="button w-full"
            >
              Select Saved Account
            </button>
          )}
          
          <button
            onClick={() => setAuthMode('register')}
            className="button w-full"
          >
            Create Account
          </button>
          
          <button
            onClick={() => setAuthMode('import')}
            className="button w-full"
          >
            Import Credentials
          </button>
          
          <button
            onClick={() => setAuthMode('login')}
            className="button w-full"
          >
            Login
          </button>
        </div>
      </div>
    </div>
  );
};
