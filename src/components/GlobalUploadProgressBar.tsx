import React, { useMemo } from 'react';
import { useUpload } from '../contexts/UploadContext';

const clamp = (n: number, min = 0, max = 100) => Math.min(Math.max(n, min), max);

const formatBytes = (bytes?: number) => {
  if (!Number.isFinite(bytes as number) || !bytes || bytes <= 0) return '0 B';
  const u = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let v = bytes;
  let i = -1;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return i === -1 ? `${bytes} B` : `${v.toFixed(v < 10 ? 2 : 1)} ${u[i]}`;
};

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

export default function GlobalUploadProgressBar() {
  const { tasks } = useUpload();

  const data = useMemo(() => {
    const uploading = tasks.filter(t => t.status === 'uploading');
    if (uploading.length === 0) {
      return {
        active: 0,
        totalBytes: 0,
        uploadedBytes: 0,
        percent: 0,
        totalBps: 0,
        etaSec: null as number | null,
      };
    }

    const totalBytes = uploading.reduce((a, t) => a + (t.totalSize || 0), 0);
    const uploadedBytes = uploading.reduce((a, t) => a + (t.uploadedSize || 0), 0);
    const totalBps = uploading.reduce((a, t) => a + (t.speedBps || 0), 0);
    const percent = totalBytes > 0 ? clamp((uploadedBytes / totalBytes) * 100) : 0;
    const remain = Math.max(0, totalBytes - uploadedBytes);
    const etaSec =
      totalBps > 0 && totalBytes > 0
        ? remain / totalBps
        : null;

    return {
      active: uploading.length,
      totalBytes,
      uploadedBytes,
      percent,
      totalBps,
      etaSec,
    };
  }, [tasks]);

  if (data.active === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        background: 'rgba(20,20,20,0.95)',
        borderBottom: '1px solid #2a2a2a',
        backdropFilter: 'blur(4px)',
      }}
    >
      {/* Bar */}
      <div style={{ height: 8, width: '100%', background: '#1f2937' }}>
        <div
          style={{
            height: '100%',
            width: `${data.percent}%`,
            transition: 'width 160ms linear',
            background:
              'linear-gradient(90deg, #60a5fa 0%, #22d3ee 50%, #34d399 100%)',
          }}
        />
      </div>

      {/* Info line */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          padding: '6px 10px',
          color: '#e5e7eb',
          fontSize: 12,
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial',
        }}
      >
        <strong style={{ color: '#93c5fd' }}>
          {data.percent.toFixed(1)}%
        </strong>

        <span style={{ opacity: 0.9 }}>
          {formatBytes(data.uploadedBytes)} / {formatBytes(data.totalBytes)}
        </span>

        {/* Speed + ETA */}
        <span style={{ opacity: 0.9 }}>
          {formatSpeed(data.totalBps)}
          {data.totalBps > 0 ? ' • ' : ' '}
          ETA {formatEta(data.etaSec)}
        </span>

        {/* Active uploads count */}
        <span style={{ marginLeft: 'auto', opacity: 0.9 }}>
          {data.active} uploading
        </span>
      </div>
    </div>
  );
}
