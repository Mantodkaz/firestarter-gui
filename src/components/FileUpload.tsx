import { useEffect, useMemo, useState } from 'react';
import { useWallet } from '../contexts/WalletContext';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useAuth } from '../contexts/AuthContext';
import { useUpload } from '../contexts/UploadContext';

// Format bytes (B, KB, MB, GB, TB)
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

// speed
const formatSpeed = (bps?: number) => {
  if (!bps || !Number.isFinite(bps) || bps <= 0) return '';
  const KB = 1024, MB = KB * 1024, GB = MB * 1024;
  if (bps >= GB) return `${(bps / GB).toFixed(2)} GB/s`;
  if (bps >= MB) return `${(bps / MB).toFixed(1)} MB/s`;
  if (bps >= KB) return `${(bps / KB).toFixed(0)} KB/s`;
  return `${bps.toFixed(0)} B/s`;
};

const formatEta = (sec?: number | null) => {
  if (sec == null || !Number.isFinite(sec)) return 'estimating…';
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}h ${m}m ${ss}s`;
  if (m > 0) return `${m}m ${ss}s`;
  return `${ss}s`;
};


function toGB(bytes: number): number {
  return bytes / (1024 ** 3);
}

interface FileUploadProps {
  onUploadSuccess?: () => void;
}

const TIER_LIST = [
  { value: 'normal', label: 'Normal' },
  { value: 'priority', label: 'Priority' },
  { value: 'premium', label: 'Premium' },
  { value: 'ultra', label: 'Ultra' },
  { value: 'enterprise', label: 'Enterprise' },
] as const;

type Tier = typeof TIER_LIST[number]['value'];

type TierInfo = {
  name: string;
  current_price: number | string;
  base_price?: number | string;
  active_users?: number;
  concurrency?: number;
  multipart_concurrency?: number;
  chunk_size_mb?: number;
};

export default function FileUpload({ onUploadSuccess }: FileUploadProps) {
  const { credentials } = useAuth();
  const { tasks, startUpload, cancelUpload } = useUpload();
  const { wallet, loading: walletLoading } = useWallet();

  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileSizeBytes, setFileSizeBytes] = useState<number>(0);

  const [remoteFileName, setRemoteFileName] = useState('');
  const [selectedTier, setSelectedTier] = useState<Tier>('normal');
  const [epochs, setEpochs] = useState('1');

  const [tierInfo, setTierInfo] = useState<TierInfo[]>([]);
  const [loadingTier, setLoadingTier] = useState(false);
  const [errorTier, setErrorTier] = useState('');

  // Wallet validation state
  const [walletValidationError, setWalletValidationError] = useState('');
  const [lastCompletedId, setLastCompletedId] = useState<string | null>(null);

  // Fetch tier pricing info 
  useEffect(() => {
    setLoadingTier(true);
    setErrorTier('');
    invoke('get_tier_pricing')
      .then((data) => {
        const arr = Array.isArray(data) ? data : [];
        setTierInfo(arr as TierInfo[]);
        setLoadingTier(false);
      })
      .catch(() => {
        setErrorTier('Failed to fetch tier info');
        setLoadingTier(false);
      });
  }, []);

  // choose current task
  const currentTask = useMemo(() => {
    if (!tasks.length) return null;
    const rIdx = [...tasks].reverse().findIndex((t) => t.status === 'uploading');
    return rIdx === -1 ? tasks[tasks.length - 1] : tasks[tasks.length - 1 - rIdx];
  }, [tasks]);

  const isUploading = currentTask?.status === 'uploading';

  // Progress 
  const pct = useMemo(() => {
    const raw = Number(currentTask?.progress ?? 0);
    if (!Number.isFinite(raw)) return 0;
    if (raw < 0) return 0;
    if (raw > 100) return 100;
    return raw;
  }, [currentTask?.progress]);
  
  // Speed and ETA
  const speedStr = useMemo(() => formatSpeed(currentTask?.speedBps), [currentTask?.speedBps]);
  const etaStr   = useMemo(() => formatEta(currentTask?.etaSec),   [currentTask?.etaSec]);

  const handleChooseFile = async () => {
    try {
      const selected = await open({ multiple: false, directory: false });
      if (typeof selected === 'string') {
        setFilePath(selected);

        // derive default remote name
        const parts = selected.split(/[/\\]/);
        setRemoteFileName(parts[parts.length - 1] ?? '');

        // query size from backend
        try {
          const size = await invoke<number>('get_file_size', { path: selected });
          setFileSizeBytes(Number(size) || 0);
        } catch {
          setFileSizeBytes(0);
        }
      } else {
        setFilePath(null);
        setRemoteFileName('');
        setFileSizeBytes(0);
      }
    } catch {
      // ignore
    }
  };

  const getFileNameForServer = () => {
    const n = remoteFileName.trim();
    if (n) return n;
    if (filePath) {
      const parts = filePath.split(/[/\\]/);
      return parts[parts.length - 1] ?? '';
    }
    return '';
  };

  const handleUpload = () => {
    if (!filePath || !credentials?.user_id) return;
    if (walletValidationError) return;

    const fileNameForServer = getFileNameForServer();
    const ep = Number(epochs);
    if (!Number.isFinite(ep) || ep < 1) return;

    // clear fields when upload starts
    startUpload(filePath, fileNameForServer, selectedTier, String(ep));
  };

  // Clear fields after task is final (success/error/cancelled) for consistent UX
  useEffect(() => {
    if (!currentTask) return;
    if (['success', 'error', 'cancelled'].includes(currentTask.status)) {
      setFilePath(null);
      setRemoteFileName('');
      setFileSizeBytes(0);
    }
  }, [currentTask?.status]);

  useEffect(() => {
    if (!currentTask) return;
    if (currentTask.status === 'success' && currentTask.id !== lastCompletedId) {
      setLastCompletedId(currentTask.id);
      if (typeof onUploadSuccess === 'function') {
        onUploadSuccess();
      }
      // Langsung fetch upload history dan trigger event
      if (credentials?.user_id) {
        setTimeout(() => {
          invoke('get_upload_history', { userId: credentials.user_id })
            .then((res) => {
              // Trigger event manual agar List pasti refresh
              window.dispatchEvent(
                new CustomEvent('upload:completed', {
                  detail: {
                    id: currentTask.id,
                    filePath: currentTask.filePath,
                    name: currentTask.remoteFileName,
                    total: currentTask.totalSize,
                    entries: res,
                  },
                })
              );
            })
            .catch(() => {
              // tetap trigger event meski gagal fetch
              window.dispatchEvent(
                new CustomEvent('upload:completed', {
                  detail: {
                    id: currentTask.id,
                    filePath: currentTask.filePath,
                    name: currentTask.remoteFileName,
                    total: currentTask.totalSize,
                  },
                })
              );
            });
        }, 100);
      }
    }
  }, [currentTask?.status, currentTask?.id, lastCompletedId, onUploadSuccess, credentials?.user_id]);

  // pick selected tier info
  const selectedTierInfo = useMemo(() => {
    return tierInfo.find((t) => t.name === selectedTier);
  }, [tierInfo, selectedTier]);

  const epochsNum = useMemo(() => {
    const ep = Number(epochs);
    return Number.isFinite(ep) && ep > 0 ? ep : 1;
  }, [epochs]);

  // compute estimated cost
  const INCLUDE_EPOCHS_IN_ESTIMATE = false; // disable epochs 
  const estimatedCost = useMemo(() => {
    if (!selectedTierInfo || !fileSizeBytes) return 0;
    const price = Number(selectedTierInfo.current_price);
    if (!Number.isFinite(price)) return 0;
    const gb = toGB(fileSizeBytes);
    const multiplier = INCLUDE_EPOCHS_IN_ESTIMATE ? epochsNum : 1;
    return gb * price * multiplier;
  }, [selectedTierInfo, fileSizeBytes, epochsNum]);


  useEffect(() => {
    if (!filePath || !wallet || walletLoading) {
      setWalletValidationError('');
      return;
    }

    const MIN_SOL = 0.01;
    const pipeNeeded = estimatedCost; // PIPE cost

    if (wallet.sol < MIN_SOL) {
      setWalletValidationError('Insufficient SOL balance');
    } else if (wallet.pipe < pipeNeeded) {
      setWalletValidationError(`Insufficient balance (need ${pipeNeeded.toFixed(6)} PIPE)`);
    } else {
      setWalletValidationError('');
    }
  }, [filePath, wallet, walletLoading, estimatedCost]);

  const hasSelection = Boolean(filePath);

  return (
    <div className="card">
      <h2>Upload File</h2>

      <div className="form-group" style={{ marginBottom: 16 }}>
        <label htmlFor="fileInput" style={{ color: '#ccc', marginBottom: 6, display: 'block' }}>File</label>
        <button className="button" style={{ width: '100%' }} onClick={handleChooseFile} disabled={isUploading}>
          {filePath ? `📄 ${filePath}` : 'Choose File...'}
        </button>

        {/* Small inline file facts */}
        {hasSelection && (
          <div style={{ marginTop: 8, fontSize: 13, color: '#9aa0a6' }}>
            Size: <b>{formatBytes(fileSizeBytes)}</b>
          </div>
        )}
      </div>

      <div className="form-group" style={{ marginBottom: 16 }}>
        <label htmlFor="remoteFileNameInput" style={{ color: '#ccc', marginBottom: 6, display: 'block' }}>Remote File Name (optional)</label>
        <input
          id="remoteFileNameInput"
          type="text"
          value={remoteFileName}
          onChange={(e) => setRemoteFileName(e.target.value)}
          disabled={isUploading}
          placeholder="Leave blank to use local file name"
          style={{
            width: '100%',
            background: '#181818',
            color: '#fff',
            border: '1px solid #444',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 16,
          }}
        />
      </div>

      <div className="form-group" style={{ marginBottom: 16, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <label htmlFor="tierSelect" style={{ color: '#ccc', marginBottom: 6, display: 'block' }}>Tier</label>
          <select
            id="tierSelect"
            value={selectedTier}
            onChange={(e) => setSelectedTier(e.target.value as Tier)}
            disabled={isUploading}
            style={{
              width: '100%',
              background: '#181818',
              color: '#fff',
              border: '1px solid #444',
              borderRadius: 6,
              padding: '8px 12px',
              fontSize: 16,
            }}
          >
            {TIER_LIST.map((tier) => (
              <option key={tier.value} value={tier.value}>
                {tier.label}
              </option>
            ))}
          </select>
        </div>

        {/* Tier info */}
        <div
          style={{
            minWidth: 260,
            maxWidth: 360,
            fontSize: 13,
            background: '#23272f',
            borderRadius: 8,
            padding: '12px 14px',
            color: '#e3e3e3',
            border: '1px solid #333'
          }}
        >
          {loadingTier ? (
            <span>Loading tier info...</span>
          ) : errorTier ? (
            <span style={{ color: '#ff4d4f' }}>{errorTier}</span>
          ) : selectedTierInfo ? (
            <div style={{ display: 'grid', gap: 5 }}>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 2 }}>
                {selectedTierInfo.name.charAt(0).toUpperCase() + selectedTierInfo.name.slice(1)}
              </div>
              <div>Current Price: <b>{selectedTierInfo.current_price}</b> PIPE / GB</div>
              {selectedTierInfo.base_price != null && (
                <div style={{ color: '#aaa' }}>Base Price: {selectedTierInfo.base_price} PIPE / GB</div>
              )}
              {selectedTierInfo.active_users != null && (
                <div>Active Users: {selectedTierInfo.active_users}</div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                {selectedTierInfo.concurrency != null && (
                  <div>Concurrency: {selectedTierInfo.concurrency}</div>
                )}
                {selectedTierInfo.multipart_concurrency != null && (
                  <div>MP Concurrency: {selectedTierInfo.multipart_concurrency}</div>
                )}
              </div>
              {selectedTierInfo.chunk_size_mb != null && (
                <div>Chunk MB: <b>{selectedTierInfo.chunk_size_mb} MB</b></div>
              )}

              <div
                style={{
                  marginTop: 8,
                  paddingTop: 8,
                  borderTop: '1px dashed #3b3f46',
                  display: 'grid',
                  gap: 4
                }}
              >
                <div style={{ color: '#9aa0a6' }}>
                  Size x Price
                </div>
                <div style={{ fontSize: 12 }}>
                  {hasSelection ? (
                    <>
                      <b>{toGB(fileSizeBytes).toFixed(4)} GB</b> x <b>{Number(selectedTierInfo.current_price)}</b>
                    </>
                  ) : (
                    <i>Select a file to calculate</i>
                  )}
                </div>
                <div style={{ marginTop: 2, fontSize: 13 }}>
                  Estimated Cost:&nbsp;
                  <b style={{ fontSize: 15 }}>
                    {hasSelection ? `${estimatedCost.toFixed(6)} PIPE` : '-'}
                  </b>
                </div>
              </div>
            </div>
          ) : (
            <span>Tier info not available</span>
          )}
        </div>
      </div>

      <div className="form-group" style={{ marginBottom: 16 }}>
        <label htmlFor="epochsInput" style={{ color: '#ccc', marginBottom: 6, display: 'block' }}>Epochs</label>
        <input
          id="epochsInput"
          type="number"
          min={1}
          value={epochs}
          onChange={(e) => setEpochs(e.target.value)}
          disabled={isUploading}
          style={{
            width: '100%',
            background: '#181818',
            color: '#fff',
            border: '1px solid #444',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 16,
          }}
        />
      </div>

      {/* Wallet validation error */}
      {walletValidationError && (
        <div style={{ color: '#ff4d4f', marginBottom: 8, fontWeight: 500, fontSize: 15 }}>
          {walletValidationError}
        </div>
      )}

      <button
        className="button"
        style={{ width: '100%', background: '#ff6600', color: '#fff', fontWeight: 600, fontSize: 18, marginBottom: 12 }}
        onClick={handleUpload}
        disabled={isUploading || !filePath || !!walletValidationError || walletLoading}
      >
        {isUploading ? 'Uploading...' : 'Upload'}
      </button>

      {currentTask && (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              marginBottom: 4,
              fontSize: 15,
              color: '#ccc',
              fontWeight: 500,
            }}
          >
            <span style={{ fontSize: 18, fontWeight: 700 }}>
              {Number.isFinite(pct) ? `${pct.toFixed(0)}%` : ''}
            </span>
            <span>
              {Number.isFinite(currentTask.uploadedSize) && Number.isFinite(currentTask.totalSize)
                ? `${formatBytes(currentTask.uploadedSize)} / ${formatBytes(currentTask.totalSize)}`
                : ''}
            </span>
            
            {currentTask.status === 'uploading' && (speedStr || etaStr) && (
              <span style={{ marginTop: 2, color: '#9aa0a6', fontSize: 13 }}>
                {speedStr ? `${speedStr}` : ''}{speedStr && etaStr ? ' • ' : ''}ETA {etaStr}
                </span>
              )}

            {currentTask.status === 'success' && (
              <span style={{ color: '#4caf50' }}>✅ Upload successful!</span>
            )}

            {currentTask.status === 'error' && (
              <span style={{ color: '#ff4d4f' }}>
                Upload failed: {currentTask.error || currentTask.message}
              </span>
            )}

            {currentTask.status === 'cancelled' && (
              <span style={{ color: '#ffb300' }}>Upload cancelled</span>
            )}
          </div>

          <div
            style={{
              width: '100%',
              height: 12,
              background: '#222',
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: Number.isFinite(pct) ? `${pct}%` : '0%',
                height: '100%',
                background: 'linear-gradient(90deg, #ff6600 60%, #ffb300 100%)',
                transition: 'width 0.3s cubic-bezier(.4,2,.6,1)',
              }}
            />
          </div>

          {currentTask.status === 'uploading' && (
            <button
              className="button"
              style={{ marginTop: 8, background: '#444', color: '#fff', fontSize: 14 }}
              onClick={() => cancelUpload(currentTask.id)}
            >
              Cancel Upload
            </button>
          )}
        </div>
      )}
    </div>
  );
}