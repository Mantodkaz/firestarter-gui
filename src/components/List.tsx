import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAuth } from '../contexts/AuthContext';
import { useDownloadSelection } from '../contexts/DownloadSelectionContext';

interface UploadLogEntry {
  local_path: string;
  remote_path: string;
  status: string;
  message: string;
  blake3_hash: string;
  file_size: number;
  timestamp: string; // ISO
}

interface ListProps {
  maxHeight?: number;
  refreshKey?: number;
  onRemoteFileClick?: (remotePath: string) => void;
}

type SortCol = 'local_path' | 'remote_path' | 'file_size' | 'status' | 'timestamp';
type SortDir = 'asc' | 'desc';

// ----- helpers ---------------------------------------------------------------
const statusColor = (status: string): string => {
  switch ((status || '').toLowerCase()) {
    case 'success':
    case 'sukses':
      return '#4ade80';
    case 'failed':
    case 'error':
    case 'gagal':
      return '#f87171';
    case 'pending':
    case 'proses':
      return '#facc15';
    case 'uploading':
      return '#38bdf8';
    default:
      return '#fff';
  }
};

const fmtBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  let i = -1;
  let v = bytes;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]}`;
};

const timeKey = (ts: string): number => {
  const t = Date.parse(ts);
  return Number.isNaN(t) ? 0 : t;
};

const fmtDateMultiline = (ts: string): string => {
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return ts;
  const d = new Date(t);
  return `${d.toLocaleDateString()}\n${d.toLocaleTimeString()}`;
};

const shortHash = (hash: string): string => {
  if (!hash) return '';
  return hash.length <= 16 ? hash : `${hash.slice(0, 8)}...${hash.slice(-4)}`;
};

const keyOf = (e: UploadLogEntry) => `${e.blake3_hash || ''}-${timeKey(e.timestamp)}`;

// ----- component -------------------------------------------------------------
export function List({ maxHeight, refreshKey, onRemoteFileClick }: ListProps) {
  const { credentials } = useAuth();
  const { setSelection } = useDownloadSelection();

  const [search, setSearch] = useState('');
  const [entries, setEntries] = useState<UploadLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState<SortCol>('timestamp');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [highlightedKeys, setHighlightedKeys] = useState<string[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // ref for storing current entries snapshot (used in listener)
  const entriesRef = useRef<UploadLogEntry[]>([]);
  useEffect(() => { entriesRef.current = entries; }, [entries]);

  // fetch history
  useEffect(() => {
    if (!credentials?.user_id) return;

    let alive = true;
    setLoading(true);
    setError('');

    invoke<UploadLogEntry[]>('get_upload_history', { userId: credentials.user_id })
      .then((res) => {
        if (!alive) return;
        const newEntries = Array.isArray(res) ? res : [];

        // highlight new rows compared to old snapshot
        const oldKeys = new Set(entriesRef.current.map(keyOf));
        const diff = newEntries.map(keyOf).filter((k) => !oldKeys.has(k));
        if (diff.length) {
          setHighlightedKeys(diff);
          setTimeout(() => setHighlightedKeys([]), 1500);
        }

        setEntries(newEntries);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e?.toString?.() ?? 'Failed to load history');
      })
      .finally(() => alive && setLoading(false));

    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials?.user_id, refreshKey]);

  // upload_history_updated -> fetch & update
  useEffect(() => {
    if (!credentials?.user_id) return;

    let unlisten: undefined | (() => void);
    (async () => {
      unlisten = await listen('upload_history_updated', async (e) => {
        const p: any = e.payload || {};
        if (p.user_id && p.user_id !== credentials.user_id) return;

        try {
          const res = await invoke<UploadLogEntry[]>('get_upload_history', { userId: credentials.user_id });
          const newEntries = Array.isArray(res) ? res : [];

          // highlight new rows compared to old snapshot
          const oldKeys = new Set(entriesRef.current.map(keyOf));
          const diff = newEntries.map(keyOf).filter((k) => !oldKeys.has(k));
          if (diff.length) {
            setHighlightedKeys(diff);
            setTimeout(() => setHighlightedKeys([]), 1500);
          }

          setEntries(newEntries);
        } catch {
          // no-op
        }
      });
    })();

    return () => { try { unlisten && unlisten(); } catch {} };
  }, [credentials?.user_id]);

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    let arr = entries;
    if (q) {
      arr = arr.filter((e) =>
        (e.local_path && e.local_path.toLowerCase().includes(q)) ||
        (e.remote_path && e.remote_path.toLowerCase().includes(q)) ||
        (e.blake3_hash && e.blake3_hash.toLowerCase().includes(q))
      );
    }

    const sorted = [...arr].sort((a, b) => {
      let A: number | string;
      let B: number | string;
      switch (sortBy) {
        case 'local_path':
          A = a.local_path.toLowerCase();
          B = b.local_path.toLowerCase();
          break;
        case 'remote_path':
          A = a.remote_path.toLowerCase();
          B = b.remote_path.toLowerCase();
          break;
        case 'file_size':
          A = a.file_size || 0;
          B = b.file_size || 0;
          break;
        case 'status':
          A = (a.status || '').toLowerCase();
          B = (b.status || '').toLowerCase();
          break;
        case 'timestamp':
        default:
          A = timeKey(a.timestamp);
          B = timeKey(b.timestamp);
          break;
      }
      if (A < B) return sortDir === 'asc' ? -1 : 1;
      if (A > B) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [entries, search, sortBy, sortDir]);

  const handleSort = useCallback((col: SortCol) => {
    setSortBy((cur) => {
      if (cur === col) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return cur;
      }
      setSortDir(col === 'timestamp' ? 'desc' : 'asc');
      return col;
    });
  }, []);

  const sortIcon = useCallback(
    (col: SortCol) => (sortBy === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : null),
    [sortBy, sortDir]
  );

  const onRowClick = useCallback(
    (remotePath: string, fileName: string) => {
      if (onRemoteFileClick) onRemoteFileClick(remotePath);
      else setSelection({ remotePath, fileName });
    },
    [onRemoteFileClick, setSelection]
  );

  const hasAnyData = entries.length > 0;
  const noResult = hasAnyData && filteredEntries.length === 0 && search.trim().length > 0;

  return (
    <div
      className="card"
      style={{
        height: maxHeight ?? '100%',
        maxHeight: maxHeight ?? 500,
        overflowY: 'auto',
        minHeight: 200,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <h2 style={{ marginBottom: 12 }}>Upload History</h2>

      {/* Search */}
      <div style={{ marginBottom: 8 }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search file name, remote path, or hash..."
          style={{
            width: '100%',
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid #333',
            background: '#181818',
            color: '#eee',
            fontSize: 13,
            outline: 'none',
          }}
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            style={{
              marginTop: 6,
              fontSize: 12,
              background: '#2a2a2a',
              color: '#ccc',
              border: '1px solid #3a3a3a',
              borderRadius: 6,
              padding: '4px 8px',
            }}
          >
            Clear
          </button>
        )}
      </div>

      {loading ? (
        <div>Loading...</div>
      ) : error ? (
        <div style={{ color: 'red' }}>{error}</div>
      ) : !hasAnyData ? (
        <div style={{ color: '#888' }}>No upload history found.</div>
      ) : noResult ? (
        <div style={{ color: '#888' }}>No results for "{search}"</div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'auto' }}>
            <thead>
              <tr style={{ background: '#232323', color: '#fff' }}>
                <th
                  style={{ padding: '4px 3px', textAlign: 'left', fontWeight: 600, position: 'sticky', top: 0, zIndex: 1, background: '#232323', cursor: 'pointer' }}
                  onClick={() => handleSort('local_path')}
                >
                  File Name{sortIcon('local_path')}
                </th>
                <th
                  style={{ padding: '4px 3px', textAlign: 'left', fontWeight: 600, position: 'sticky', top: 0, zIndex: 1, background: '#232323', cursor: 'pointer' }}
                  onClick={() => handleSort('remote_path')}
                >
                  Remote Path{sortIcon('remote_path')}
                </th>
                <th style={{ padding: '4px 3px', textAlign: 'left', fontWeight: 600, position: 'sticky', top: 0, zIndex: 1, background: '#232323' }}>
                  Hash
                </th>
                <th
                  style={{ padding: '4px 3px', textAlign: 'right', fontWeight: 600, position: 'sticky', top: 0, zIndex: 1, background: '#232323', cursor: 'pointer' }}
                  onClick={() => handleSort('file_size')}
                >
                  Size{sortIcon('file_size')}
                </th>
                <th
                  style={{ padding: '4px 3px', textAlign: 'left', fontWeight: 600, position: 'sticky', top: 0, zIndex: 1, background: '#232323', cursor: 'pointer' }}
                  onClick={() => handleSort('status')}
                >
                  Status{sortIcon('status')}
                </th>
                <th
                  style={{ padding: '4px 3px', textAlign: 'left', fontWeight: 600, position: 'sticky', top: 0, zIndex: 1, background: '#232323', cursor: 'pointer' }}
                  onClick={() => handleSort('timestamp')}
                >
                  Time{sortIcon('timestamp')}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((entry, idx) => {
                const key = `${entry.blake3_hash || ''}-${timeKey(entry.timestamp) || idx}`;
                const fname = entry.local_path?.split(/[/\\]/).pop() || entry.local_path || '';
                const isHi = highlightedKeys.includes(key);

                return (
                  <tr
                    key={key}
                    style={{
                      background: isHi ? 'linear-gradient(90deg, #facc15 0%, #fffbe6 100%)' : idx % 2 === 0 ? '#191919' : '#222',
                      color: isHi ? '#222' : '#eee',
                      transition: 'background 0.7s, color 0.7s',
                    }}
                  >
                    <td style={{ padding: '4px 3px' }} title={entry.local_path}>
                      {fname}
                    </td>

                    <td
                      style={{ padding: '4px 3px', cursor: 'pointer', wordBreak: 'break-all', whiteSpace: 'normal', color: '#eee', transition: 'color 0.2s, textDecoration 0.2s' as any }}
                      title={entry.remote_path}
                      onClick={() => onRowClick(entry.remote_path, fname)}
                      onMouseOver={(e) => {
                        e.currentTarget.style.textDecoration = 'underline';
                        e.currentTarget.style.color = '#4faaff';
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.textDecoration = 'none';
                        e.currentTarget.style.color = '#eee';
                      }}
                    >
                      {entry.remote_path}
                    </td>

                    <td
                      style={{
                        padding: '4px 3px',
                        fontFamily: 'monospace',
                        fontSize: 12,
                        wordBreak: 'break-all',
                        whiteSpace: 'pre-line',
                        background: copiedKey === key ? '#ffe066' : undefined,
                        color: copiedKey === key ? '#222' : undefined,
                        cursor: 'pointer',
                        transition: 'background 0.5s, color 0.5s',
                        position: 'relative',
                      }}
                      title={entry.blake3_hash}
                      tabIndex={0}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(entry.blake3_hash);
                          setCopiedKey(key);
                          setTimeout(() => setCopiedKey(null), 1200);
                        } catch {
                          // ignore
                        }
                      }}
                    >
                      {shortHash(entry.blake3_hash)}
                      <span
                        style={{
                          position: 'absolute',
                          left: '50%',
                          top: '-1.5em',
                          transform: 'translateX(-50%)',
                          background: '#ffe066',
                          color: '#222',
                          fontSize: 11,
                          padding: '2px 10px',
                          borderRadius: 6,
                          pointerEvents: 'none',
                          zIndex: 10,
                          opacity: copiedKey === key ? 1 : 0,
                          transition: 'opacity 0.4s',
                          boxShadow: copiedKey === key ? '0 2px 8px rgba(0,0,0,0.10)' : undefined,
                        }}
                      >
                        Copied!
                      </span>
                    </td>

                    <td style={{ padding: '4px 3px', textAlign: 'right' }}>{fmtBytes(entry.file_size)}</td>

                    <td style={{ padding: '4px 3px', fontWeight: 600, color: statusColor(entry.status), textTransform: 'capitalize' }}>
                      {entry.status || '-'}
                    </td>

                    <td style={{ padding: '4px 3px', whiteSpace: 'pre-line' }}>{fmtDateMultiline(entry.timestamp)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
