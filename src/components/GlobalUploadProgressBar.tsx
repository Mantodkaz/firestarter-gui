import React from 'react';
import { useUpload } from '../contexts/UploadContext';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

const barHeight = 8;

const GlobalUploadProgressBar: React.FC = () => {
  const { tasks } = useUpload();
  // get active upload tasks
  const activeTasks = tasks.filter(t => t.status === 'uploading');
  if (activeTasks.length === 0) return null;

  // if multiple uploads are active, show combined progress
  const total = activeTasks.reduce((acc, t) => acc + (t.totalSize || 0), 0);
  const uploaded = activeTasks.reduce((acc, t) => acc + (t.uploadedSize || 0), 0);
  const percent = total > 0 ? Math.floor((uploaded / total) * 100) : 0;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 9999,
      background: 'rgba(24,24,24,0.96)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
      height: barHeight + 18,
      display: 'flex',
      alignItems: 'center',
      padding: '0 24px',
      pointerEvents: 'none',
    }}>
      <div style={{ flex: 1 }}>
        <div style={{
          width: '100%',
          height: barHeight,
          background: '#222',
          borderRadius: 6,
          overflow: 'hidden',
        }}>
          <div style={{
            width: percent + '%',
            height: '100%',
            background: 'linear-gradient(90deg, #ff6600 60%, #ffb300 100%)',
            transition: 'width 0.3s cubic-bezier(.4,2,.6,1)',
          }} />
        </div>
      </div>
      <div style={{ color: '#fff', fontSize: 13, marginLeft: 16, minWidth: 120, textAlign: 'right', fontFamily: 'Inter, sans-serif' }}>
        {percent}% &nbsp; {formatBytes(uploaded)} / {formatBytes(total)}
      </div>
    </div>
  );
};

export default GlobalUploadProgressBar;
