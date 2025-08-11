import React from 'react';
import FileUpload from '../components/FileUpload';
import FileDownload from '../components/FileDownload';
import { List } from '../components/List';

function UploadDownload() {
  const leftColRef = React.useRef<HTMLDivElement>(null);
  const [leftHeight, setLeftHeight] = React.useState<number | undefined>(undefined);
  const [historyRefreshKey, setHistoryRefreshKey] = React.useState(0);

  React.useEffect(() => {
    if (leftColRef.current) {
      setLeftHeight(leftColRef.current.offsetHeight);
    }
  });

  // Handler trigger refresh upload history
  const handleUploadSuccess = () => {
    setHistoryRefreshKey(k => k + 1);
  };

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'stretch', minHeight: 400 }}>
      <div ref={leftColRef} style={{ flex: 1, minWidth: 320, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <FileUpload onUploadSuccess={handleUploadSuccess} />
        <FileDownload />
      </div>
      <div style={{ flex: 1, minWidth: 320, display: 'flex', flexDirection: 'column', height: leftHeight ? leftHeight : 'auto' }}>
        <List maxHeight={leftHeight ? leftHeight - 8 : undefined} refreshKey={historyRefreshKey} />
      </div>
    </div>
  );
}

export default UploadDownload
