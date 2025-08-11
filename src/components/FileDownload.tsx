import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { useAuth } from '../contexts/AuthContext';
import { useDownloadSelection } from '../contexts/DownloadSelectionContext';

function FileDownload() {
  const { getValidAccessToken } = useAuth();
  const { selection, setSelection } = useDownloadSelection();

  const [fileName, setFileName] = useState('');
  const [downloadPath, setDownloadPath] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState('');
  const [isError, setIsError] = useState(false);

  // Prefill from selection (clicked in history)
  useEffect(() => {
    if (selection?.remotePath) {
      setFileName(selection.remotePath);
      setSelection(null);
    }
  }, [selection, setSelection]);

  const handleChooseLocation = async () => {
    if (!fileName.trim()) {
      setDownloadMessage('Please enter a file name first');
      setIsError(true);
      return;
    }

    try {
      const selected = await save({
        defaultPath: fileName.trim(),
      });

      if (selected) {
        setDownloadPath(selected);
        setDownloadMessage('');
        setIsError(false);
      }
    } catch (error: any) {
      setDownloadMessage(`Failed to open save dialog: ${error?.message || String(error)}`);
      setIsError(true);
    }
  };

  const handleDownload = async () => {
    const name = fileName.trim();
    if (!name) {
      setDownloadMessage('Please enter a file name');
      setIsError(true);
      return;
    }
    if (!downloadPath) {
      setDownloadMessage('Please choose a download location first');
      setIsError(true);
      return;
    }

    setIsDownloading(true);
    setDownloadMessage('');
    setIsError(false);

    try {
      const token = await getValidAccessToken();
      if (!token) {
        setDownloadMessage('Session expired or JWT invalid. Please login again.');
        setIsError(true);
        return;
      }

      const result = await invoke<string>('download_file', {
        fileName: name,
        outputPath: downloadPath,
        token,
      });

      setDownloadMessage(result || 'Download completed');
      setIsError(false);

      // Optional reset
      setTimeout(() => {
        setFileName('');
        setDownloadPath('');
        setDownloadMessage('');
      }, 3000);
    } catch (error: any) {
      setDownloadMessage(error?.message || String(error));
      setIsError(true);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="card">
      <h3>Download Files From Storage</h3>

      <div className="form-group">
        <label>Remote FileName:</label>
        <input
          type="text"
          value={fileName}
          onChange={(e) => setFileName(e.target.value)}
          placeholder="Enter Remote FileName To Download"
          disabled={isDownloading}
        />
      </div>

      <div className="form-group">
        <label>Download Location:</label>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <button
            className="button"
            onClick={handleChooseLocation}
            disabled={isDownloading || !fileName.trim()}
            style={{ minWidth: '120px', opacity: (!fileName.trim() || isDownloading) ? 0.5 : 1 }}
          >
            Choose Location
          </button>
          {downloadPath && (
            <span style={{ color: '#e5e5e5', fontSize: '0.9rem' }}>
              {downloadPath}
            </span>
          )}
        </div>
        <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '0.5rem' }}>
          {downloadPath ? 'File will be saved to the selected location' : 'Please choose where to save the file'}
        </div>
      </div>

      {downloadMessage && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.75rem',
            borderRadius: '4px',
            background: isError ? '#660000' : '#006600',
            border: `1px solid ${isError ? '#cc0000' : '#00cc00'}`,
            color: isError ? '#ffcccc' : '#ccffcc',
          }}
        >
          {downloadMessage}
        </div>
      )}

      <button
        className="button"
        onClick={handleDownload}
        disabled={!fileName.trim() || isDownloading}
        style={{ opacity: (!fileName.trim() || isDownloading) ? 0.5 : 1, cursor: (!fileName.trim() || isDownloading) ? 'not-allowed' : 'pointer' }}
      >
        {isDownloading ? 'Downloading...' : 'Download File'}
      </button>

      <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: '#888', textAlign: 'center' }}>
        Tip: Download requires valid session credentials
      </div>
    </div>
  );
}

export default FileDownload;
