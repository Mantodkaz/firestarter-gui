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

interface UserRegistrationProps {
  onSuccess: (credentials: SavedCredentials) => void;
  onCancel: () => void;
}

export const UserRegistration: React.FC<UserRegistrationProps> = ({ onSuccess, onCancel }) => {
  const [step, setStep] = useState<'username' | 'password'>('username');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [userCredentials, setUserCredentials] = useState<SavedCredentials | null>(null);

  const handleUsernameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username.trim()) {
      setError('Username is required');
      return;
    }

    if (username.length < 3) {
      setError('Username must be at least 3 characters');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      console.log('Creating new user:', username);
      
      const response = await invoke<SavedCredentials>('create_new_user', {
        username: username.trim(),
      });

      console.log('✅ User created successfully');
      setUserCredentials(response);
      setStep('password');
    } catch (err) {
      console.error('❌ User creation error:', err);
      const errorMessage = err as string;
      
      if (errorMessage.includes('already exists') || errorMessage.includes('taken')) {
        setError('Username already exists. Please choose a different one.');
      } else if (errorMessage.includes('invalid')) {
        setError('Invalid username. Use only letters, numbers, and underscores.');
      } else {
        setError('Failed to create user. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!password || !confirmPassword) {
      setError('Both password fields are required');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (!userCredentials) {
      setError('User credentials not found. Please start over.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      console.log('🔐 Setting user password...');
      
      const authTokensJson = await invoke<string>('set_user_password', {
        userId: userCredentials.user_id,
        userAppKey: userCredentials.user_app_key,
        newPassword: password,
      });

      console.log('✅ Password set successfully, received JWT tokens');

      // Parse the JSON response
      const authTokens: AuthTokens = JSON.parse(authTokensJson);

      // Create final credentials with JWT tokens
      const finalCredentials: SavedCredentials = {
        ...userCredentials,
        auth_tokens: authTokens,
        username: username.trim(),
      };

      // The onSuccess callback will handle saving via AuthContext
      onSuccess(finalCredentials);
    } catch (err) {
      console.error('❌ Password setting error:', err);
      const errorMessage = err as string;
      
      if (errorMessage.includes('weak')) {
        setError('Password is too weak. Use a mix of letters, numbers, and symbols.');
      } else if (errorMessage.includes('locked')) {
        setError('Account is locked. Please try again later.');
      } else {
        setError('Failed to set password. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    if (step === 'password') {
      setStep('username');
      setPassword('');
      setConfirmPassword('');
      setError('');
    } else {
      onCancel();
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <div className="card">
        <h2>Create New Account</h2>
        <p className="text-sm opacity-70 mb-6">
          {step === 'username' 
            ? 'Choose a username for your Pipe Network account'
            : 'Set a secure password for your account'
          }
        </p>

        {step === 'username' ? (
          <form onSubmit={handleUsernameSubmit}>
            <div className="form-group">
              <label>Username:</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                disabled={isLoading}
                autoFocus
              />
            </div>

            {error && (
              <div className="error-message">
                {error}
              </div>
            )}

            <div className="auth-buttons">
              <button
                type="button"
                className="button"
                onClick={onCancel}
                disabled={isLoading}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button"
                disabled={isLoading || !username.trim()}
              >
                {isLoading ? 'Creating...' : 'Continue'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handlePasswordSubmit}>
            <div className="form-group">
              <label>Password:</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter a secure password"
                disabled={isLoading}
                autoFocus
              />
            </div>

            <div className="form-group">
              <label>Confirm Password:</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                disabled={isLoading}
              />
            </div>

            {error && (
              <div className="error-message">
                {error}
              </div>
            )}

            <div className="auth-buttons">
              <button
                type="button"
                className="button"
                onClick={handleBack}
                disabled={isLoading}
              >
                Back
              </button>
              <button
                type="submit"
                className="button"
                disabled={isLoading || !password || !confirmPassword}
              >
                {isLoading ? 'Setting Password...' : 'Create Account'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
