import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import apiEndpoints from '../api_endpoints.json';

interface SavedCredentials {
  user_id: string;
  user_app_key: string;
  auth_tokens?: any;
  username?: string;
}

interface UserSelectorProps {
  onUserSelect: (credentials: SavedCredentials) => void;
  onCancel: () => void;
  onLoginRequired: (credentials: SavedCredentials) => void;
}

export const UserSelector: React.FC<UserSelectorProps> = ({ 
  onUserSelect, 
  onCancel, 
  onLoginRequired 
}) => {
//  const { listSavedUsers, getUserApiConfig } = useAuth();
  const { listSavedUsers } = useAuth();
  const [users, setUsers] = useState<SavedCredentials[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState<string | null>(null);

  const performFreshLogin = async (user: SavedCredentials) => {
    setIsAuthenticating(user.user_id);
    
    try {
      // First try to refresh token if available
      if (user.auth_tokens?.refresh_token) {
        try {
          console.log('Attempting to refresh token for user:', user.username);
          const refreshResponse = await fetch(`${apiEndpoints.api_base_url}${apiEndpoints.auth_refresh}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              refresh_token: user.auth_tokens.refresh_token
            })
          });

          if (refreshResponse.ok) {
            const refreshData = await refreshResponse.json();
            
            // Update auth tokens with new access token
            const updatedCredentials = {
              ...user,
              auth_tokens: {
                ...user.auth_tokens,
                access_token: refreshData.access_token,
                expires_in: refreshData.expires_in,
                token_type: refreshData.token_type,
                expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString()
              }
            };

            console.log('✅ Token refreshed successfully for user:', user.username);
            onUserSelect(updatedCredentials);
            return;
          } else {
            console.warn('Token refresh failed, response:', refreshResponse.status);
          }
        } catch (error) {
          console.warn('Token refresh failed with error:', error);
        }
      }

      // If refresh failed or no refresh token, require manual login
      console.log('🔐 Fresh login required for user:', user.username || user.user_id);
      onLoginRequired(user);

    } catch (error) {
      console.error('Authentication error:', error);
      onLoginRequired(user);
    } finally {
      setIsAuthenticating(null);
    }
  };

  useEffect(() => {
    const loadUsers = async () => {
      try {
        const savedUsers = await listSavedUsers();
        setUsers(savedUsers);
      } catch (error) {
        console.error('Failed to load saved users:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadUsers();
  }, [listSavedUsers]);

  if (isLoading) {
    return (
      <div className="max-w-md mx-auto">
        <div className="card">
          <h2>Loading Saved Accounts...</h2>
          <div className="loading-spinner"></div>
        </div>
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="max-w-md mx-auto">
        <div className="card">
          <h2>No Saved Accounts</h2>
          <p className="text-sm opacity-70 mb-4">
            No saved accounts found on this device.
          </p>
          <button onClick={onCancel} className="button">
            Continue to Login/Register
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto">
      <div className="card">
        <h2>Select Account</h2>
        <p className="text-sm opacity-70 mb-4">
          Choose from saved accounts on this device:
        </p>

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
                  <div className="font-medium">
                    {user.username || `User ${user.user_id.substring(0, 8)}...`}
                  </div>
                  <div className="text-sm opacity-70">
                    ID: {user.user_id.substring(0, 8)}...
                  </div>
                  <div className="text-xs opacity-50">
                    {user.auth_tokens ? '🔐 JWT Auth' : '🔑 Legacy Auth'}
                  </div>
                </div>
                <div className="text-sm opacity-70">
                  {isAuthenticating === user.user_id ? '⏳' : '→'}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 pt-4 border-t border-gray-600">
          <div className="auth-buttons">
            <button onClick={onCancel} className="button">
              Use Different Account
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
