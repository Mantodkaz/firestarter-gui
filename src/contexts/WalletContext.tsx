import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { invoke } from '@tauri-apps/api/core';
import { ep } from '../shared/api/endpoints';

export interface WalletInfo {
  address: string;
  sol: number;
  pipe: number;
}

interface WalletContextType {
  wallet: WalletInfo | null;
  refreshWallet: () => Promise<void>;
  loading: boolean;
  error: string;
}

export const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const useWallet = () => {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
};

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { credentials, getValidAccessToken } = useAuth();
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchWallet = useCallback(async () => {
    if (!credentials?.user_id) {
      setWallet(null);
      setError('No user credentials');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const accessToken = await getValidAccessToken?.();
      if (!accessToken) throw new Error('No valid access token');

      // Fetch SOL wallet info
      const solRes = await invoke<any>('proxy_api_post', {
        url: ep('check_wallet'),
        body: { user_id: credentials.user_id },
        accessToken,
      });

      // Fetch PIPE token info
      const pipeRes = await invoke<any>('proxy_api_post', {
        url: ep('check_custom_token'),
        body: { user_id: credentials.user_id, token: 'PIPE' },
        accessToken,
      });

      setWallet({
        address: solRes?.public_key || '-',
        sol: solRes?.balance_sol || 0,
        pipe: pipeRes?.ui_amount || 0,
      });
    } catch (e: any) {
      setError(e?.message || 'Failed to fetch wallet info');
      setWallet(null);
    } finally {
      setLoading(false);
    }
  }, [credentials, getValidAccessToken]);

  useEffect(() => {
    fetchWallet();
    // Only refetch when credentials change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials]);

  return (
    <WalletContext.Provider value={{ wallet, refreshWallet: fetchWallet, loading, error }}>
      {children}
    </WalletContext.Provider>
  );
};
