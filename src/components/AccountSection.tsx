import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export const AccountSection: React.FC = () => {
  const { credentials, logout, hasJWT, deleteAccountData } = useAuth();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE ME') {
      return;
    }

    if (!credentials?.user_id) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteAccountData(credentials.user_id);
      setShowDeleteConfirm(false);
      setDeleteConfirmText('');
    } catch (error) {
      console.error('Failed to delete account:', error);
      alert('Failed to delete account data. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const cancelDelete = () => {
    setShowDeleteConfirm(false);
    setDeleteConfirmText('');
  };

  if (!credentials) {
    return <div>No account information available</div>;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h2>Account Information</h2>
      
      <div className="space-y-4">
        <div className="card">
          <h3>Credentials</h3>
          <div className="space-y-2 text-sm">
            <div><strong>User ID:</strong> {credentials.user_id}</div>
            <div><strong>App Key:</strong> {credentials.user_app_key.substring(0, 20)}...</div>
            {credentials.username && (
              <div><strong>Username:</strong> {credentials.username}</div>
            )}
          </div>
        </div>

        <div className={`card ${hasJWT ? 'bg-green-900' : 'bg-yellow-900'}`}>
          <h3>Authentication Status</h3>
          {hasJWT ? (
            <div className="space-y-2 text-sm text-green-300">
              <div>✅ JWT Authentication: Active</div>
              <div><strong>Token Type:</strong> {credentials.auth_tokens?.token_type}</div>
              {credentials.auth_tokens?.expires_at && (
                <div><strong>Expires:</strong> {new Date(credentials.auth_tokens.expires_at).toLocaleString()}</div>
              )}
            </div>
          ) : (
            <div className="text-sm text-yellow-300">
              ⚠️ Using legacy authentication (no JWT tokens)
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="text-red-400">Danger Zone</h3>
          <div className="space-y-4">
            <div>
              <button
                onClick={logout}
                className="button"
                style={{ background: '#4a5568', color: '#e5e5e5' }}
              >
                Logout (Keep Account Data)
              </button>
              <p className="text-sm opacity-70 mt-2">
                This will log you out but keep your credentials saved for easy login later.
              </p>
            </div>

            {!showDeleteConfirm ? (
              <div>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="button"
                  style={{ background: '#e53e3e', color: 'white' }}
                >
                  Delete Account Data
                </button>
                <p className="text-sm opacity-70 mt-2">
                  Permanently delete all saved account data from this device.
                </p>
              </div>
            ) : (
              <div className="p-4 border border-red-500 rounded bg-red-900 bg-opacity-20">
                <h4 className="text-red-400 font-semibold mb-2">⚠️ Confirm Account Deletion</h4>
                <p className="text-sm mb-4">
                  This action will permanently delete all saved account data for user <strong>{credentials.username || credentials.user_id}</strong> from this device. This cannot be undone.
                </p>
                <p className="text-sm mb-4">
                  Type <strong>DELETE ME</strong> to confirm:
                </p>
                <div className="form-group">
                  <input
                    type="text"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder="Type DELETE ME to confirm"
                    disabled={isDeleting}
                  />
                </div>
                <div className="auth-buttons">
                  <button
                    onClick={cancelDelete}
                    className="button"
                    disabled={isDeleting}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteAccount}
                    className="button"
                    style={{ 
                      background: deleteConfirmText === 'DELETE ME' ? '#e53e3e' : '#666',
                      color: 'white'
                    }}
                    disabled={deleteConfirmText !== 'DELETE ME' || isDeleting}
                  >
                    {isDeleting ? 'Deleting...' : 'Delete Account Data'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
