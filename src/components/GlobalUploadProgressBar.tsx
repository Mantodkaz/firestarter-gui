import React, { useMemo } from 'react';
import { useUpload } from '../contexts/UploadContext';

const BAR_HEIGHT = 8;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= k && i < units.length - 1) {
    v /= k;
    i++;
  }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]}`;
}

const GlobalUploadProgressBar: React.FC = () => {
  const { tasks } = useUpload();

  const { activeCount, total, uploaded, percent } = useMemo(() => {
    const active = tasks.filter((t) => t.status === 'uploading');
    const totalBytes = active.reduce((acc, t) => acc + (t.totalSize || 0), 0);
    const uploadedBytes = active.reduce((acc, t) => acc + (t.uploadedSize || 0), 0);
    const pct = totalBytes > 0 ? Math.min(100, Math.max(0, Math.floor((uploadedBytes / totalBytes) * 100))) : 0;
    return { activeCount: active.length, total: totalBytes, uploaded: uploadedBytes, percent: pct };
  }, [tasks]);

  if (activeCount === 0) return null;

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label="Global upload progress"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: 'rgba(24,24,24,0.96)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        height: BAR_HEIGHT + 18,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        pointerEvents: 'none',
      }}
    >
      <div style={{ flex: 1 }}>
        <div
          style={{
            width: '100%',
            height: BAR_HEIGHT,
            background: '#222',
            borderRadius: 6,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${percent}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #ff6600 60%, #ffb300 100%)',
              transition: 'width 200ms cubic-bezier(.4,2,.6,1)',
              willChange: 'width',
            }}
          />
        </div>
      </div>

      <div
        style={{
          color: '#fff',
          fontSize: 12,
          marginLeft: 12,
          minWidth: 160,
          textAlign: 'right',
          lineHeight: 1.2,
          fontFamily: 'Inter, system-ui, sans-serif',
          whiteSpace: 'nowrap',
        }}
      >
        <div style={{ opacity: 0.9 }}>{percent}%</div>
        <div style={{ opacity: 0.7 }}>{formatBytes(uploaded)} / {formatBytes(total)}{activeCount > 1 ? ` • ${activeCount} uploads` : ''}</div>
      </div>
    </div>
  );
};

export default GlobalUploadProgressBar;
