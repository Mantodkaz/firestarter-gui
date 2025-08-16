import { useCallback, useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useWallet } from '../contexts/WalletContext';
import { invoke } from '@tauri-apps/api/core';
import { ep } from '../shared/api/endpoints';

type TierDetail = {
  tier_name: string;
  transfer_count: number;
  gb_transferred: number;
  base_cost: number;
  final_cost: number;
  avg_multiplier: number;
  tokens_burned: number;
  tokens_to_treasury: number;
};

type UsageBreakdown = {
  gb_transferred: number;
  tokens_spent: number;
  tokens_burned: number;
  tokens_to_treasury?: number;
  transfer_count?: number;
  tier_details?: Record<string, TierDetail>;
};
type Usage = {
  period: string;
  user_id: string;
  breakdown: Partial<Record<'bandwidth' | 'storage' | 'total', UsageBreakdown>>;
};

const PERIODS = [
  { value: '7d', label: 'Day' },
  { value: '30d', label: 'Week' },
  { value: '90d', label: 'Month' },
  { value: '365d', label: 'Year' },
  { value: 'all', label: 'All' },
] as const;

type Period = typeof PERIODS[number]['value'];

function Wallet() {
  const { credentials } = useAuth();
  const { wallet, loading, error, refreshWallet } = useWallet();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [usagePeriod, setUsagePeriod] = useState<Period>('30d');
  const [swapAmount, setSwapAmount] = useState('');
  const [swapResult, setSwapResult] = useState<any>(null);
  const [isSwapping, setIsSwapping] = useState(false);
  const [withdrawSolTo, setWithdrawSolTo] = useState('');
  const [withdrawSolAmount, setWithdrawSolAmount] = useState('');
  const [withdrawSolResult, setWithdrawSolResult] = useState<any>(null);
  const [isWithdrawingSol, setIsWithdrawingSol] = useState(false);

  // Only usage, swap, withdraw need backend fetch here
  const handleTokenUsage = useCallback(
    async (period: Period) => {
      setUsagePeriod(period);
      try {
        if (!credentials?.user_id || !credentials?.user_app_key) throw new Error('No user_id or user_app_key');
        const data = (await invoke('get_token_usage', {
          period,
          credentials: {
            user_id: credentials.user_id,
            user_app_key: credentials.user_app_key,
            auth_tokens: credentials.auth_tokens || undefined,
            username: credentials.username || undefined,
          },
        })) as Usage;
        setUsage(data);
      } catch (e: any) {
        // Optionally show error
      }
    },
    [credentials]
  );

  // Fetch usage automatically on mount
  useEffect(() => {
    if (credentials?.user_id && credentials?.user_app_key) {
      handleTokenUsage(usagePeriod);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials?.user_id, credentials?.user_app_key]);

  // Swap SOL to PIPE
  const handleSwap = useCallback(async () => {
    setIsSwapping(true);
    setSwapResult(null);
    try {
      if (!credentials?.auth_tokens?.access_token) throw new Error('No access token');
      const amountNum = parseFloat(swapAmount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) throw new Error('Invalid amount');
      const url = ep('exchange_sol_for_tokens');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: '*/*',
        Authorization: `Bearer ${credentials.auth_tokens.access_token}`,
      };
      const data = await invoke('proxy_api_post', {
        url,
        headers,
        body: { amount_sol: amountNum },
      });
      setSwapResult(data);
      await refreshWallet();
    } catch (e: any) {
      setSwapResult({ error: e?.message || 'Swap failed' });
    } finally {
      setIsSwapping(false);
    }
  }, [credentials, swapAmount, refreshWallet]);

  // Withdraw SOL
  const handleWithdrawSol = useCallback(async () => {
    setIsWithdrawingSol(true);
    setWithdrawSolResult(null);
    try {
      if (!credentials?.auth_tokens?.access_token) throw new Error('No access token');
      const amountNum = parseFloat(withdrawSolAmount);
      if (!withdrawSolTo || !Number.isFinite(amountNum) || amountNum <= 0) throw new Error('Invalid address or amount');
      const url = ep('withdraw_sol');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: '*/*',
        Authorization: `Bearer ${credentials.auth_tokens.access_token}`,
      };
      const data = await invoke('proxy_api_post', {
        url,
        headers,
        body: { to_pubkey: withdrawSolTo, amount_sol: amountNum },
      });
      setWithdrawSolResult(data);
      await refreshWallet();
    } catch (e: any) {
      setWithdrawSolResult({ error: e?.message || 'Withdraw failed' });
    } finally {
      setIsWithdrawingSol(false);
    }
  }, [credentials, withdrawSolTo, withdrawSolAmount, refreshWallet]);

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
        boxSizing: 'border-box',
        paddingRight: 24,
      }}
    >
      {/* Overlay spinner for global loading (not for actions) */}
  {loading && (
        <div
          style={{
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
          }}
        >
          <div className="loading-spinner">
            <span className="spinner" />
            {loading}
          </div>
        </div>
      )}

      {/* Left: Balance and actions */}
      <div style={{ flex: '0 0 380px', minWidth: 320, maxWidth: 420, wordBreak: 'break-all', paddingRight: 8 }}>
        <h2 style={{ marginBottom: 18 }}>Wallet</h2>
        {error && <div className="error-message">{error}</div>}

        {/* Info Address, SOL, PIPE */}
        <div
          style={{
            marginBottom: 28,
            display: 'grid',
            gridTemplateColumns: '80px 1fr',
            rowGap: 8,
            alignItems: 'center',
          }}
        >
          <div style={{ color: '#aaa', textAlign: 'right', fontSize: 14, fontWeight: 500 }}>Address:</div>
          <div style={{ fontFamily: 'monospace', fontSize: 15, color: '#fff', wordBreak: 'break-all', paddingLeft: 6 }}>
            {wallet?.address || '-'}
          </div>
          <div style={{ color: '#aaa', textAlign: 'right', fontSize: 14, fontWeight: 500 }}>SOL:</div>
          <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 15, color: '#fff', paddingLeft: 6 }}>
            {wallet?.sol ?? '-'}
          </div>
          <div style={{ color: '#aaa', textAlign: 'right', fontSize: 14, fontWeight: 500 }}>PIPE:</div>
          <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 15, color: '#fff', paddingLeft: 6 }}>
            {wallet?.pipe ?? '-'}
          </div>
        </div>

        {/* Swap */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, color: '#aaa', fontWeight: 600, marginBottom: 6 }}>Swap SOL to PIPE</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input
              type="number"
              placeholder="Amount (SOL)"
              value={swapAmount}
              onChange={(e) => setSwapAmount(e.target.value)}
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
            <div
              style={{
                background: '#202a36',
                color: '#b8eaff',
                border: '1px solid #2a3b4d',
                borderRadius: 6,
                padding: '10px 14px',
                marginTop: 8,
                fontSize: 13,
                lineHeight: 1.7,
                wordBreak: 'break-all',
              }}
            >
              <div style={{ fontWeight: 600, color: '#7fd7ff', marginBottom: 2 }}>Swap Result</div>
              <div>
                <span style={{ color: '#aaa' }}>SOL Spent:</span>{' '}
                <span style={{ fontFamily: 'monospace' }}>{swapResult.sol_spent ?? '-'}</span>
              </div>
              <div>
                <span style={{ color: '#aaa' }}>PIPE Minted:</span>{' '}
                <span style={{ fontFamily: 'monospace' }}>{swapResult.tokens_minted ?? '-'}</span>
              </div>
              {swapResult.user_id && (
                <div>
                  <span style={{ color: '#aaa' }}>User ID:</span>{' '}
                  <span style={{ fontFamily: 'monospace' }}>{swapResult.user_id}</span>
                </div>
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
              onChange={(e) => setWithdrawSolTo(e.target.value)}
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
              onChange={(e) => setWithdrawSolAmount(e.target.value)}
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
            <div
              style={{
                background: '#202a36',
                color: '#b8eaff',
                border: '1px solid #2a3b4d',
                borderRadius: 6,
                padding: '10px 14px',
                marginTop: 8,
                fontSize: 13,
                lineHeight: 1.7,
                wordBreak: 'break-all',
              }}
            >
              <div style={{ fontWeight: 600, color: '#7fd7ff', marginBottom: 2 }}>Withdraw SOL Result</div>
              <div>
                <span style={{ color: '#aaa' }}>Amount (SOL):</span>{' '}
                <span style={{ fontFamily: 'monospace' }}>{withdrawSolResult.amount_sol ?? '-'}</span>
              </div>
              <div>
                <span style={{ color: '#aaa' }}>To Address:</span>{' '}
                <span style={{ fontFamily: 'monospace' }}>{withdrawSolResult.to_pubkey ?? '-'}</span>
              </div>
              {withdrawSolResult.signature && (
                <div>
                  <span style={{ color: '#aaa' }}>Signature:</span>{' '}
                  <span style={{ fontFamily: 'monospace' }}>{withdrawSolResult.signature}</span>
                </div>
              )}
              {withdrawSolResult.user_id && (
                <div>
                  <span style={{ color: '#aaa' }}>User ID:</span>{' '}
                  <span style={{ fontFamily: 'monospace' }}>{withdrawSolResult.user_id}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right: Token Usage */}
  <div style={{ flex: 1, minWidth: 320, wordBreak: 'break-all', paddingLeft: 8, boxSizing: 'border-box', overflow: 'visible' }}>
        <h3 style={{ marginBottom: 8 }}>Token Usage</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {PERIODS.map((p) => (
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
          <div style={{ width: '100%', color: '#e3e3e3', fontSize: 14, background: 'none', marginBottom: 8 }}>
            {/* Storage Analysis */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#7fd7ff', marginBottom: 4 }}>📦 Storage Analysis</div>
              <div style={{ marginBottom: 2 }}>Total Volume: <b>{Number(usage.breakdown.storage?.gb_transferred ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 })} GB</b></div>
              <div style={{ marginBottom: 2 }}>Total Cost: <b>{Number(usage.breakdown.storage?.tokens_spent ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 })} PIPE</b></div>
              <div style={{ marginBottom: 2 }}>Total Uploads: <b>{usage.breakdown.storage?.transfer_count ?? 0}</b></div>
              {usage.breakdown.storage?.tier_details && (
                <div style={{ marginTop: 8, marginBottom: 2, fontWeight: 600 }}>By Tier:</div>
              )}
              {usage.breakdown.storage?.tier_details && (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {Object.values(usage.breakdown.storage.tier_details).map((tier: any) => (
                    <li key={tier.tier_name} style={{ marginBottom: 2 }}>
                      <span style={{ fontWeight: 600 }}>{tier.tier_name}</span>
                      <span style={{ color: '#aaa' }}> ({tier.avg_multiplier}x): </span>
                      <span>{Number(tier.gb_transferred).toLocaleString(undefined, { maximumFractionDigits: 2 })} GB</span>
                      <span style={{ color: '#aaa' }}> = </span>
                      <span>{Number(tier.tokens_burned).toLocaleString(undefined, { maximumFractionDigits: 4 })} PIPE</span>
                      <span style={{ color: '#aaa' }}> ({tier.transfer_count} uploads)</span>
                    </li>
                  ))}
                </ul>
              )}
              <hr style={{ border: 'none', borderTop: '2px dashed #2a3b4d', margin: '18px 0 12px 0' }} />
            </div>
            {/* Bandwidth Analysis */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#7fd7ff', marginBottom: 4 }}>🌐 Bandwidth Analysis</div>
              <div style={{ marginBottom: 2 }}>Total Volume: <b>{Number(usage.breakdown.bandwidth?.gb_transferred ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 })} GB</b></div>
              <div style={{ marginBottom: 2 }}>Total Cost: <b>{Number(usage.breakdown.bandwidth?.tokens_spent ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 })} PIPE</b></div>
              <div style={{ marginBottom: 2 }}>Total Downloads: <b>{usage.breakdown.bandwidth?.transfer_count ?? 0}</b></div>
              <hr style={{ border: 'none', borderTop: '2px dashed #2a3b4d', margin: '18px 0 12px 0' }} />
            </div>
            {/* Token Distribution */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#7fd7ff', marginBottom: 4 }}>💰 Token Distribution</div>
              <div style={{ marginBottom: 2 }}>Total Spent: <b>{Number(usage.breakdown.total?.tokens_spent ?? 0).toLocaleString(undefined, { maximumFractionDigits: 6 })} PIPE</b></div>
              <div style={{ marginBottom: 2 }}>Burned: <b>{Number(usage.breakdown.total?.tokens_burned ?? 0).toLocaleString(undefined, { maximumFractionDigits: 6 })} PIPE</b> ({usage.breakdown.total?.tokens_spent ? ((Number(usage.breakdown.total.tokens_burned) / Number(usage.breakdown.total.tokens_spent)) * 100).toFixed(1) : '0'}%)</div>
              <div style={{ marginBottom: 2 }}>Treasury: <b>{Number(usage.breakdown.total?.tokens_to_treasury ?? 0).toLocaleString(undefined, { maximumFractionDigits: 6 })} PIPE</b> ({usage.breakdown.total?.tokens_spent ? ((Number(usage.breakdown.total.tokens_to_treasury) / Number(usage.breakdown.total.tokens_spent)) * 100).toFixed(1) : '0'}%)</div>
              <hr style={{ border: 'none', borderTop: '2px dashed #2a3b4d', margin: '18px 0 12px 0' }} />
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
