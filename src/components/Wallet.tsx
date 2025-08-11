
import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { invoke } from '@tauri-apps/api/core';
import apiEndpoints from '../api_endpoints.json';

type TokenInfo = {
  ui_amount: number;
};
type SolInfo = {
  public_key: string;
  balance_sol: number;
};
type UsageBreakdown = {
  gb_transferred: number;
  tokens_spent: number;
  tokens_burned: number;
};
type Usage = {
  period: string;
  user_id: string;
  breakdown: {
    bandwidth?: UsageBreakdown;
    storage?: UsageBreakdown;
    total?: UsageBreakdown;
  };
};

const periods = [
  { value: '7d', label: 'Day' },
  { value: '30d', label: 'Week' },
  { value: '90d', label: 'Month' },
  { value: '365d', label: 'Year' },
  { value: 'all', label: 'All' },
];

function Wallet() {
  const { credentials } = useAuth();
  const [solInfo, setSolInfo] = useState<SolInfo | null>(null);
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [usagePeriod, setUsagePeriod] = useState('30d');
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [swapAmount, setSwapAmount] = useState('');
  const [swapResult, setSwapResult] = useState<any>(null);
  const [isSwapping, setIsSwapping] = useState(false);
  const [withdrawSolTo, setWithdrawSolTo] = useState('');
  const [withdrawSolAmount, setWithdrawSolAmount] = useState('');
  const [withdrawSolResult, setWithdrawSolResult] = useState<any>(null);
  const [isWithdrawingSol, setIsWithdrawingSol] = useState(false);
  // Withdraw PIPE
  // const [withdrawPipeTo, setWithdrawPipeTo] = useState('');
  // const [withdrawPipeAmount, setWithdrawPipeAmount] = useState('');
  // const [withdrawPipeResult, setWithdrawPipeResult] = useState<any>(null);
  // const [isWithdrawingPipe, setIsWithdrawingPipe] = useState(false);


  // Handler functions
  const handleCheckSol = async () => {
    setError('');
    setLoading('Loading SOL...'); 
    try {
      if (!credentials?.user_id || !credentials?.user_app_key) throw new Error('No user_id or user_app_key');
      const url = apiEndpoints.api_base_url + apiEndpoints.check_wallet;
      const headers: Record<string, string> = {};
      if (credentials?.auth_tokens?.access_token) {
        headers['Authorization'] = `Bearer ${credentials.auth_tokens.access_token}`;
      }
      const data = await invoke('proxy_api_post', {
        url,
        headers,
        body: {
          user_id: credentials.user_id,
          user_app_key: credentials.user_app_key,
        },
      });
      setSolInfo(data as SolInfo);
    } catch (e: any) {
      setError(e?.message ? String(e.message) : JSON.stringify(e));
    } finally {
      setLoading('');
    }
  };

  // get pipe info
  const handleCheckToken = async () => {
    setError('');
    setLoading('Loading PIPE...'); 
    try {
      if (!credentials?.user_id || !credentials?.user_app_key) throw new Error('No user_id or user_app_key');
      const url = apiEndpoints.api_base_url + apiEndpoints.check_custom_token;
      const headers: Record<string, string> = {};
      if (credentials?.auth_tokens?.access_token) {
        headers['Authorization'] = `Bearer ${credentials.auth_tokens.access_token}`;
      }
      const data = await invoke('proxy_api_post', {
        url,
        headers,
        body: {
          user_id: credentials.user_id,
          user_app_key: credentials.user_app_key,
        },
      });
      setTokenInfo(data as TokenInfo);
    } catch (e: any) {
      setError(e?.message ? String(e.message) : JSON.stringify(e));
    } finally {
      setLoading('');
    }
  };
  const handleSwap = async () => {
    setError('');
    setLoading('Processing...'); // Overlay spinner appears instantly
    setIsSwapping(true);
    setSwapResult(null);
    try {
      if (!credentials?.auth_tokens?.access_token) throw new Error('No access token');
      const url = apiEndpoints.api_base_url + apiEndpoints.exchange_sol_for_tokens;
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${credentials.auth_tokens.access_token}`,
        'Content-Type': 'application/json',
        'Accept': '*/*',
      };
      const amountNum = parseFloat(swapAmount);
      if (isNaN(amountNum) || amountNum <= 0) throw new Error('Invalid amount');
      const data = await invoke('proxy_api_post', {
        url,
        headers,
        body: {
          amount_sol: amountNum,
        },
      });
      setSwapResult(data);
      // Refresh wallet info after swap
      await handleCheckSol();
      await handleCheckToken();
      await handleTokenUsage(usagePeriod);
    } catch (e: any) {
      setError(e?.message ? String(e.message) : JSON.stringify(e));
    } finally {
      setIsSwapping(false);
      setLoading('');
    }
  };

  const handleWithdrawSol = async () => {
    setError('');
    setLoading('Processing...');
    setIsWithdrawingSol(true);
    setWithdrawSolResult(null);
    try {
      if (!credentials?.auth_tokens?.access_token) throw new Error('No access token');
      const url = apiEndpoints.api_base_url + apiEndpoints.withdraw_sol;
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${credentials.auth_tokens.access_token}`,
        'Content-Type': 'application/json',
        'Accept': '*/*',
      };
      const amountNum = parseFloat(withdrawSolAmount);
      if (!withdrawSolTo || isNaN(amountNum) || amountNum <= 0) throw new Error('Invalid address or amount');
      const data = await invoke('proxy_api_post', {
        url,
        headers,
        body: {
          to_pubkey: withdrawSolTo,
          amount_sol: amountNum,
        },
      });
      setWithdrawSolResult(data);
      // Refresh wallet info after withdraw
      await handleCheckSol();
      await handleTokenUsage(usagePeriod);
    } catch (e: any) {
      setError(e?.message ? String(e.message) : JSON.stringify(e));
    } finally {
      setIsWithdrawingSol(false);
      setLoading('');
    }
  };

  // const handleWithdrawPipe = async () => {
  //   setError('');
  //   setLoading('Processing...'); // Overlay spinner appears instantly
  //   setIsWithdrawingPipe(true);
  //   setWithdrawPipeResult(null);
  //   try {
  //     if (!credentials?.auth_tokens?.access_token) throw new Error('No access token');
  //     // If there is a dedicated endpoint for PIPE withdraw, change here
  //     const url = apiEndpoints.api_base_url + apiEndpoints.withdraw_sol;
  //     const headers: Record<string, string> = {
  //       'Authorization': `Bearer ${credentials.auth_tokens.access_token}`,
  //       'Content-Type': 'application/json',
  //       'Accept': '*/*',
  //     };
  //     const amountNum = parseFloat(withdrawPipeAmount);
  //     if (!withdrawPipeTo || isNaN(amountNum) || amountNum <= 0) throw new Error('Invalid address or amount');
  //     const data = await invoke('proxy_api_post', {
  //       url,
  //       headers,
  //       body: {
  //         to_pubkey: withdrawPipeTo,
  //         amount_sol: amountNum,
  //       },
  //     });
  //     setWithdrawPipeResult(data);
  //     // Refresh wallet info after withdraw
  //     await handleCheckToken();
  //     await handleTokenUsage(usagePeriod);
  //   } catch (e: any) {
  //     setError(e?.message ? String(e.message) : JSON.stringify(e));
  //   } finally {
  //     setIsWithdrawingPipe(false);
  //     setLoading('');
  //   }
  // };

  // Token Usage (Rust command get_token_usage)
  const handleTokenUsage = async (period: string) => {
    setError('');
    setUsagePeriod(period);
    setLoading('Loading usage...'); 
    try {
      if (!credentials?.user_id || !credentials?.user_app_key) throw new Error('No user_id or user_app_key');

      // console.log('handleTokenUsage params', { period, credentials });
      const data = await invoke('get_token_usage', {
        period,
        credentials: {
          user_id: credentials.user_id,
          user_app_key: credentials.user_app_key,
          auth_tokens: credentials.auth_tokens || undefined,
          username: credentials.username || undefined,
        },
      });
      setUsage(data as Usage);
    } catch (e: any) {
      setError(e?.message ? String(e.message) : JSON.stringify(e));
      // console.error('handleTokenUsage error', e);
    } finally {
      setLoading('');
    }
  };

  React.useEffect(() => {
    if (credentials?.user_id && credentials?.user_app_key) {
      handleCheckSol();
      handleCheckToken();
      handleTokenUsage(usagePeriod);
    }
    // eslint-disable-next-line
  }, [credentials?.user_id, credentials?.user_app_key]);

  return (
    <div
      className="card wallet-responsive"
      style={{
        maxWidth: 1100,
        margin: '2rem auto',
        display: 'flex',
        gap: 32,
        alignItems: 'flex-start',
        flexWrap: 'nowrap',
        position: 'relative',
        minHeight: 420,
      }}
    >
      {/* Overlay spinner for global loading (not for actions) */}
      {loading && loading !== 'Loading usage...' && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(20,20,20,0.65)',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 8,
        }}>
          <div className="loading-spinner"><span className="spinner" />{loading}</div>
        </div>
      )}
      {/* Left: Balance and actions */}
      <div style={{ flex: '0 0 380px', minWidth: 320, maxWidth: 420, wordBreak: 'break-all', paddingRight: 8 }}>
        <h2 style={{ marginBottom: 18 }}>Wallet</h2>
        {error && <div className="error-message">{error}</div>}

        {/* Info Address, SOL, PIPE */}
        <div style={{
          marginBottom: 28,
          display: 'grid',
          gridTemplateColumns: '80px 1fr',
          rowGap: 8,
          alignItems: 'center',
        }}>
          <div style={{ color: '#aaa', textAlign: 'right', fontSize: 14, fontWeight: 500 }}>Address:</div>
          <div style={{ fontFamily: 'monospace', fontSize: 15, color: '#fff', wordBreak: 'break-all', paddingLeft: 6 }}>{solInfo?.public_key || '-'}</div>
          <div style={{ color: '#aaa', textAlign: 'right', fontSize: 14, fontWeight: 500 }}>SOL:</div>
          <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 15, color: '#fff', paddingLeft: 6 }}>{solInfo?.balance_sol ?? '-'}</div>
          <div style={{ color: '#aaa', textAlign: 'right', fontSize: 14, fontWeight: 500 }}>PIPE:</div>
          <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 15, color: '#fff', paddingLeft: 6 }}>{tokenInfo?.ui_amount ?? '-'}</div>
        </div>

        {/* Swap */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, color: '#aaa', fontWeight: 600, marginBottom: 6 }}>Swap SOL to PIPE</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input
              type="number"
              placeholder="Amount (SOL)"
              value={swapAmount}
              onChange={e => setSwapAmount(e.target.value)}
              disabled={!!loading || isSwapping}
              style={{
                width: 110,
                fontSize: 15,
                background: '#181818',
                color: '#fff',
                border: '1px solid #333',
                borderRadius: 6,
                padding: '6px 10px',
                outline: 'none',
              }}
            />
            <button
              className="button"
              onClick={handleSwap}
              disabled={!!loading || isSwapping || !swapAmount}
              style={{
                background: '#232323',
                color: '#fff',
                border: '1px solid #333',
                borderRadius: 6,
                padding: '7px 22px',
                fontWeight: 600,
                fontSize: 15,
                minWidth: 70,
                height: 36,
                cursor: !!loading || isSwapping || !swapAmount ? 'not-allowed' : 'pointer',
                opacity: !!loading || isSwapping || !swapAmount ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {isSwapping && <span className="spinner" style={{ marginRight: 8, verticalAlign: 'middle' }} />}
              Swap
            </button>
          </div>
          {swapResult && (
            <div style={{
              background: '#202a36',
              color: '#b8eaff',
              border: '1px solid #2a3b4d',
              borderRadius: 6,
              padding: '10px 14px',
              marginTop: 8,
              fontSize: 13,
              lineHeight: 1.7,
              wordBreak: 'break-all',
            }}>
              <div style={{ fontWeight: 600, color: '#7fd7ff', marginBottom: 2 }}>Swap Result</div>
              <div><span style={{ color: '#aaa' }}>SOL Spent:</span> <span style={{ fontFamily: 'monospace' }}>{swapResult.sol_spent ?? '-'}</span></div>
              <div><span style={{ color: '#aaa' }}>PIPE Minted:</span> <span style={{ fontFamily: 'monospace' }}>{swapResult.tokens_minted ?? '-'}</span></div>
              {swapResult.user_id && (
                <div><span style={{ color: '#aaa' }}>User ID:</span> <span style={{ fontFamily: 'monospace' }}>{swapResult.user_id}</span></div>
              )}
            </div>
          )}
        </div>

    {/* Withdraw SOL */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, color: '#aaa', fontWeight: 600, marginBottom: 6 }}>Withdraw SOL</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="To Address (SOL)"
              value={withdrawSolTo}
              onChange={e => setWithdrawSolTo(e.target.value)}
              disabled={!!loading}
              style={{
                width: 180,
                fontSize: 15,
                background: '#181818',
                color: '#fff',
                border: '1px solid #333',
                borderRadius: 6,
                padding: '6px 10px',
                outline: 'none',
              }}
            />
            <input
              type="number"
              placeholder="Amount (SOL)"
              value={withdrawSolAmount}
              onChange={e => setWithdrawSolAmount(e.target.value)}
              disabled={!!loading}
              style={{
                width: 110,
                fontSize: 15,
                background: '#181818',
                color: '#fff',
                border: '1px solid #333',
                borderRadius: 6,
                padding: '6px 10px',
                outline: 'none',
              }}
            />
            <button
              className="button"
              onClick={handleWithdrawSol}
              disabled={!!loading || !withdrawSolTo || !withdrawSolAmount}
              style={{
                background: '#232323',
                color: '#fff',
                border: '1px solid #333',
                borderRadius: 6,
                padding: '7px 26px',
                fontWeight: 600,
                fontSize: 15,
                minWidth: 100,
                height: 36,
                whiteSpace: 'nowrap',
                cursor: !!loading || !withdrawSolTo || !withdrawSolAmount ? 'not-allowed' : 'pointer',
                opacity: !!loading || !withdrawSolTo || !withdrawSolAmount ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {isWithdrawingSol && <span className="spinner" style={{ marginRight: 8, verticalAlign: 'middle' }} />}
              Withdraw
            </button>
          </div>
          {withdrawSolResult && (
            <div style={{
              background: '#202a36',
              color: '#b8eaff',
              border: '1px solid #2a3b4d',
              borderRadius: 6,
              padding: '10px 14px',
              marginTop: 8,
              fontSize: 13,
              lineHeight: 1.7,
              wordBreak: 'break-all',
            }}>
              <div style={{ fontWeight: 600, color: '#7fd7ff', marginBottom: 2 }}>Withdraw SOL Result</div>
              <div><span style={{ color: '#aaa' }}>Amount (SOL):</span> <span style={{ fontFamily: 'monospace' }}>{withdrawSolResult.amount_sol ?? '-'}</span></div>
              <div><span style={{ color: '#aaa' }}>To Address:</span> <span style={{ fontFamily: 'monospace' }}>{withdrawSolResult.to_pubkey ?? '-'}</span></div>
              {withdrawSolResult.signature && (
                <div><span style={{ color: '#aaa' }}>Signature:</span> <span style={{ fontFamily: 'monospace' }}>{withdrawSolResult.signature}</span></div>
              )}
              {withdrawSolResult.user_id && (
                <div><span style={{ color: '#aaa' }}>User ID:</span> <span style={{ fontFamily: 'monospace' }}>{withdrawSolResult.user_id}</span></div>
              )}
            </div>
          )}
        </div>

        {/*
        Withdraw PIPE (disabled)
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 13, color: '#aaa', marginBottom: 2 }}>Withdraw PIPE</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <input
              type="text"
              placeholder="To Address (PIPE)"
              value={withdrawPipeTo}
              onChange={e => setWithdrawPipeTo(e.target.value)}
              disabled={!!loading}
              style={{
                width: 180,
                fontSize: 15,
                background: '#181818',
                color: '#fff',
                border: '1px solid #333',
                borderRadius: 6,
                padding: '6px 10px',
                outline: 'none',
              }}
            />
            <input
              type="number"
              placeholder="Amount PIPE"
              value={withdrawPipeAmount}
              onChange={e => setWithdrawPipeAmount(e.target.value)}
              disabled={!!loading}
              style={{
                width: 80,
                fontSize: 15,
                background: '#181818',
                color: '#fff',
                border: '1px solid #333',
                borderRadius: 6,
                padding: '6px 10px',
                outline: 'none',
              }}
            />
            <button
              className="button"
              onClick={handleWithdrawPipe}
              disabled={!!loading || !withdrawPipeTo || !withdrawPipeAmount}
              style={{
                background: '#232323',
                color: '#fff',
                border: '1px solid #333',
                borderRadius: 6,
                padding: '6px 18px',
                fontWeight: 600,
                cursor: !!loading || !withdrawPipeTo || !withdrawPipeAmount ? 'not-allowed' : 'pointer',
                opacity: !!loading || !withdrawPipeTo || !withdrawPipeAmount ? 0.6 : 1,
              }}
            >
              {isWithdrawingPipe && <span className="spinner" style={{ marginRight: 8, verticalAlign: 'middle' }} />}
              Withdraw
            </button>
          </div>
          {withdrawPipeResult && (
            <div style={{ fontSize: 12, color: '#8ef', marginTop: 2 }}>Withdraw PIPE Result: {JSON.stringify(withdrawPipeResult)}</div>
          )}
        </div>
        */}
  </div>
  {/* Right: Token Usage */}
  <div style={{ flex: 1, minWidth: 320, wordBreak: 'break-all', paddingLeft: 8 }}>
    <h3 style={{ marginBottom: 8 }}>Token Usage</h3>
    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
      {periods.map((p) => (
        <button
          key={p.value}
          className={`tab${usagePeriod === p.value ? ' active' : ''}`}
          onClick={() => handleTokenUsage(p.value)}
          disabled={!!loading}
          style={{ fontSize: 13, padding: '4px 12px' }}
        >
          {p.label}
        </button>
      ))}
    </div>
    {usage && usage.breakdown && (
      <div style={{ width: '100%' }}>
        <div style={{ width: '100%' }}>
          <table style={{ width: '100%', background: '#181818', color: '#fff', borderCollapse: 'collapse', fontSize: 13, marginBottom: 8, tableLayout: 'fixed' }}>
            <thead>
              <tr style={{ background: '#222' }}>
                <th style={{ width: '28%', padding: '6px 8px', border: '1px solid #333', textAlign: 'left', whiteSpace: 'normal' }}>Type</th>
                <th style={{ width: '24%', padding: '6px 4px', border: '1px solid #333', textAlign: 'right', whiteSpace: 'normal' }}>GB</th>
                <th style={{ width: '24%', padding: '6px 4px', border: '1px solid #333', textAlign: 'right', whiteSpace: 'normal' }}>Spent</th>
                <th style={{ width: '24%', padding: '6px 4px', border: '1px solid #333', textAlign: 'right', whiteSpace: 'normal' }}>Burned</th>
              </tr>
            </thead>
            <tbody>
              {(usage ? (['bandwidth', 'storage', 'total'] as const) : []).map((key) => {
                const breakdown = usage?.breakdown[key];
                if (!breakdown) return null;
                return (
                  <tr key={key} style={{ background: key === 'total' ? '#232323' : undefined, fontWeight: key === 'total' ? 600 : 400 }}>
                    <td style={{ padding: '6px 8px', border: '1px solid #333', textTransform: 'capitalize' }}>{key}</td>
                    <td style={{ padding: '6px 8px', border: '1px solid #333', textAlign: 'right' }}>{Number(breakdown.gb_transferred).toLocaleString(undefined, { maximumFractionDigits: 3 })}</td>
                    <td style={{ padding: '6px 8px', border: '1px solid #333', textAlign: 'right' }}>{Number(breakdown.tokens_spent).toLocaleString(undefined, { maximumFractionDigits: 3 })}</td>
                    <td style={{ padding: '6px 8px', border: '1px solid #333', textAlign: 'right' }}>{Number(breakdown.tokens_burned).toLocaleString(undefined, { maximumFractionDigits: 3 })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 12, color: '#aaa', marginBottom: 2 }}>
          Period: <b>{usage.period}</b> &nbsp;|&nbsp; User ID: <span style={{ fontFamily: 'monospace' }}>{usage.user_id}</span>
        </div>
      </div>
    )}
  </div>
  </div>
  );
}

export { Wallet };

