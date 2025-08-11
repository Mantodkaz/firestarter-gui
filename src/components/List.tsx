import { useEffect, useMemo, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAuth } from '../contexts/AuthContext';
import { useDownloadSelection } from '../contexts/DownloadSelectionContext';

interface UploadLogEntry {
  local_path: string;
  remote_path: string;
  status: string;
  message: string;
  blake3_hash: string;
  file_size: number;
  timestamp: string; // ISO format
}

interface ListProps {
  maxHeight?: number;
  refreshKey?: number;
  onRemoteFileClick?: (remotePath: string) => void;
}

type SortCol = 'local_path' | 'remote_path' | 'file_size' | 'status' | 'timestamp';
type SortDir = 'asc' | 'desc';

// helpers
function getStatusColor(status: string): string {
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
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  let i = -1;
  let value = bytes;
  do {
    value = value / 1024;
    i++;
  } while (value >= 1024 && i < units.length - 1);
  return `${value.toFixed(value < 10 ? 2 : 1)} ${units[i]}`;
}

function formatDate(ts: string): string {
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return ts;
  const d = new Date(t);
  const dateStr = d.toLocaleDateString();
  const timeStr = d.toLocaleTimeString();
  return `${dateStr}\n${timeStr}`;
}

function timeKey(ts: string): number {
  const t = Date.parse(ts);
  return Number.isNaN(t) ? 0 : t;
}

export function List({ maxHeight, refreshKey, onRemoteFileClick }: ListProps) {
  const { credentials } = useAuth();
  const { setSelection } = useDownloadSelection();

  // search box SELALU tampil
  const [search, setSearch] = useState('');

  const [entries, setEntries] = useState<UploadLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState<SortCol>('timestamp');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [highlightedKeys, setHighlightedKeys] = useState<string[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!credentials?.user_id) return;

    let mounted = true;
    setLoading(true);
    setError('');

    invoke<UploadLogEntry[]>('get_upload_history', { userId: credentials.user_id })
      .then((res) => {
        if (!mounted) return;
        const newEntries = Array.isArray(res) ? res : [];

        if (entries.length > 0 && newEntries.length > entries.length) {
          const oldKeys = new Set(entries.map((e) => `${e.blake3_hash || ''}-${timeKey(e.timestamp)}`));
          const newKeys = newEntries.map((e) => `${e.blake3_hash || ''}-${timeKey(e.timestamp)}`);
          const diffKeys = newKeys.filter((k) => !oldKeys.has(k));
          if (diffKeys.length > 0) {
            setHighlightedKeys(diffKeys);
            setTimeout(() => setHighlightedKeys([]), 1800);
          }
        }
        setEntries(newEntries);
      })
      .catch((e) => {
        if (!mounted) return;
        setError(e?.toString?.() ?? 'Failed to load history');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [credentials?.user_id, refreshKey]);

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
    arr = [...arr];
    arr.sort((a, b) => {
      let vA: number | string;
      let vB: number | string;
      switch (sortBy) {
        case 'local_path':
          vA = a.local_path.toLowerCase();
          vB = b.local_path.toLowerCase();
          break;
        case 'remote_path':
          vA = a.remote_path.toLowerCase();
          vB = b.remote_path.toLowerCase();
          break;
        case 'file_size':
          vA = a.file_size || 0;
          vB = b.file_size || 0;
          break;
        case 'status':
          vA = (a.status || '').toLowerCase();
          vB = (b.status || '').toLowerCase();
          break;
        case 'timestamp':
        default:
          vA = timeKey(a.timestamp);
          vB = timeKey(b.timestamp);
          break;
      }
      if (vA < vB) return sortDir === 'asc' ? -1 : 1;
      if (vA > vB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [entries, sortBy, sortDir, search]);

  const handleSort = useCallback((col: SortCol) => {
    setSortBy((current) => {
      if (current === col) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return current;
      }
      setSortDir(col === 'timestamp' ? 'desc' : 'asc');
      return col;
    });
  }, []);

  const sortIcon = useCallback(
    (col: SortCol) => {
      if (sortBy !== col) return null;
      return sortDir === 'asc' ? ' ▲' : ' ▼';
    },
    [sortBy, sortDir]
  );

  const onRowClick = useCallback(
    (remotePath: string, fileName: string) => {
      if (onRemoteFileClick) {
        onRemoteFileClick(remotePath);
      } else {
        setSelection({ remotePath, fileName });
      }
    },
    [setSelection, onRemoteFileClick]
  );

  function shortHash(hash: string): string {
    if (!hash) return '';
    if (hash.length <= 16) return hash;
    return hash.slice(0, 8) + '...' + hash.slice(-4);
  }

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

      {/* Search SELALU nampak (kecuali sedang loading parah, tapi tetap kita tampilkan) */}
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
                <th
                  style={{ padding: '4px 3px', textAlign: 'left', fontWeight: 600, position: 'sticky', top: 0, zIndex: 1, background: '#232323' }}
                >
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
                const isHighlighted = highlightedKeys.includes(key);
                return (
                  <tr
                    key={key}
                    style={{
                      background: isHighlighted
                        ? 'linear-gradient(90deg, #facc15 0%, #fffbe6 100%)'
                        : idx % 2 === 0
                        ? '#191919'
                        : '#222',
                      color: isHighlighted ? '#222' : '#eee',
                      transition: 'background 0.7s, color 0.7s',
                    }}
                  >
                    <td style={{ padding: '4px 3px' }} title={entry.local_path}>
                      {fname}
                    </td>
                    <td
                      style={{
                        padding: '4px 3px',
                        cursor: 'pointer',
                        wordBreak: 'break-all',
                        whiteSpace: 'normal',
                        color: '#eee',
                        transition: 'color 0.2s, text-decoration 0.2s',
                      }}
                      title={entry.remote_path}
                      onClick={() => onRowClick(entry.remote_path, fname)}
                      onMouseOver={(e) => {
                        (e.currentTarget as HTMLElement).style.textDecoration = 'underline';
                        (e.currentTarget as HTMLElement).style.color = '#4faaff';
                      }}
                      onMouseOut={(e) => {
                        (e.currentTarget as HTMLElement).style.textDecoration = 'none';
                        (e.currentTarget as HTMLElement).style.color = '#eee';
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
                        } catch {}
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
                    <td style={{ padding: '4px 3px', textAlign: 'right' }}>
                      {formatBytes(entry.file_size)}
                    </td>
                    <td
                      style={{
                        padding: '4px 3px',
                        fontWeight: 600,
                        color: getStatusColor(entry.status),
                        textTransform: 'capitalize',
                      }}
                    >
                      {entry.status || '-'}
                    </td>
                    <td style={{ padding: '4px 3px', whiteSpace: 'pre-line' }}>{formatDate(entry.timestamp)}</td>
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
