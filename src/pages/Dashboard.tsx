import React, { useLayoutEffect, useRef, useState } from 'react';
import FileUpload from '../components/FileUpload';
import FileDownload from '../components/FileDownload';
import { List } from '../components/List';

const Dashboard: React.FC = () => {
  const leftColRef = useRef<HTMLDivElement>(null);
  const [leftHeight, setLeftHeight] = useState<number | undefined>(undefined);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  useLayoutEffect(() => {
    const el = leftColRef.current;
    if (!el) return;

    setLeftHeight(el.offsetHeight);

    let ro: ResizeObserver | null = null;
    let onResize: (() => void) | null = null;

    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => setLeftHeight(el.offsetHeight));
      ro.observe(el);
    } else if (typeof window !== 'undefined') {
      onResize = () => setLeftHeight(el.offsetHeight);
      window.addEventListener('resize', onResize);
    }

    return () => {
      if (ro) ro.disconnect();
      if (onResize && typeof window !== 'undefined') {
        window.removeEventListener('resize', onResize);
      }
    };
  }, []);

  const handleUploadSuccess = () => setHistoryRefreshKey((k) => k + 1);

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'stretch', minHeight: 400 }}>
      <div
        ref={leftColRef}
        style={{ flex: 1, minWidth: 320, display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <FileUpload onUploadSuccess={handleUploadSuccess} />
        <FileDownload />
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 320,
          display: 'flex',
          flexDirection: 'column',
          height: leftHeight ?? 'auto',
        }}
      >
        <List maxHeight={leftHeight ? leftHeight - 8 : undefined} refreshKey={historyRefreshKey} />
      </div>
    </div>
  );
};

export default Dashboard;
