import React, { useState } from 'react';
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

interface UserLoginProps {
  onSuccess: (credentials: SavedCredentials) => void;
  onCancel: () => void;
  existingCredentials?: SavedCredentials;
  importMessage?: string;
}

export const UserLogin: React.FC<UserLoginProps> = ({ onSuccess, onCancel, existingCredentials, importMessage }) => {
  const [username, setUsername] = useState(existingCredentials?.username || '');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username.trim() || !password.trim()) {
      setError('Username and password are required');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const authTokensJson = await invoke<string>('user_login', {
        username: username.trim(),
        password: password,
      });

      console.log('✅ Login successful');

      // Parse the JSON response
      const authTokens: AuthTokens = JSON.parse(authTokensJson);

      // Create credentials with JWT tokens
      let credentials: SavedCredentials;
      
      if (existingCredentials) {
        // Update existing credentials with new tokens
        credentials = {
          ...existingCredentials,
          auth_tokens: authTokens,
          username: username.trim(),
        };
      } else {
        // For fresh login without existing credentials, need to load 
        // user's saved credentials by username first
        try {
          const savedUsers = await invoke<SavedCredentials[]>('list_saved_users');
          const existingUser = savedUsers.find(user => 
            user.username?.toLowerCase() === username.trim().toLowerCase()
          );
          
          if (existingUser) {
            // Update existing user with new JWT tokens
            credentials = {
              ...existingUser,
              auth_tokens: authTokens,
              username: username.trim(),
            };
          } else {
            // No local credentials found, user needs to register or import first
            setError(`No local account found for "${username}". Please register a new account or import your existing credentials first.`);
            return;
          }
        } catch (listError) {
          console.error('❌ Failed to list saved users:', listError);
          setError('Failed to access local user data. Please try again or import your credentials.');
          return;
        }
      }

      // Save updated credentials
      await invoke('save_credentials', { credentials });
      console.log('✅ Credentials updated with JWT tokens');
      
      onSuccess(credentials);
    } catch (err) {
      console.error('❌ Login error:', err);
      const errorMessage = err as string;
      
      if (errorMessage.includes('locked')) {
        setError('Account is locked due to too many failed attempts. Please contact support.');
      } else if (errorMessage.includes('Too many')) {
        setError('Too many login attempts. Please try again later.');
      } else {
        setError(`Login failed: ${errorMessage}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <div className="card">
        <h2>Login</h2>
        
        {importMessage && (
          <div style={{ 
            padding: '0.75rem', 
            borderRadius: '4px', 
            marginBottom: '1rem',
            background: '#d4edda',
            color: '#155724',
            border: '1px solid #c3e6cb'
          }}>
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
              placeholder={existingCredentials?.username ? `Login as: ${existingCredentials.username}` : "Enter your username"}
              disabled={isLoading}
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
            />
          </div>

          {error && (
            <div style={{ color: '#ff6b6b', fontSize: '0.875rem', marginBottom: '1rem' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={onCancel}
              className="button"
              style={{ flex: 1 }}
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button"
              style={{ flex: 1 }}
              disabled={isLoading || !username.trim() || !password.trim()}
            >
              {isLoading ? 'Logging in...' : 'Login'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
