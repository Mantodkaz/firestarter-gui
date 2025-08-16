import { useEffect, useMemo, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { save } from '@tauri-apps/plugin-dialog';
import { useAuth } from '../contexts/AuthContext';
import { useDownloadSelection } from '../contexts/DownloadSelectionContext';

function FileDownload() {
  const { credentials } = useAuth();
  const { selection, setSelection } = useDownloadSelection();

  const [fileName, setFileName] = useState('');
  const [downloadPath, setDownloadPath] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [message, setMessage] = useState<string>('');
  const [isError, setIsError] = useState(false);
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null);
  const [downloaded, setDownloaded] = useState<number>(0);
  const [total, setTotal] = useState<number>(0);
  const progressEventUnlisten = useRef<(() => void) | null>(null);
  // Listen for download progress events
  useEffect(() => {
    if (!isDownloading) return;
    setDownloadPercent(0);
    setDownloaded(0);
    setTotal(0);
    let unlisten: (() => void) | null = null;
    listen('download_progress', (event) => {
      const { percent, downloaded, total } = event.payload as any;
      setDownloadPercent(percent);
      setDownloaded(downloaded);
      setTotal(total);
    }).then((fn) => {
      unlisten = fn;
      progressEventUnlisten.current = fn;
    });
    return () => {
      if (unlisten) unlisten();
      progressEventUnlisten.current = null;
    };
  }, [isDownloading]);

  // Prefill from selection
  useEffect(() => {
    if (selection?.remotePath) {
      setFileName(selection.remotePath);
      setSelection(null);
    }
  }, [selection, setSelection]);

  const canDownload = useMemo(() => !!fileName.trim() && !isDownloading, [fileName, isDownloading]);

  const chooseLocation = async () => {
    if (!fileName.trim()) {
      setMessage('Please enter a file name first');
      setIsError(true);
      return;
    }

    try {
      const selected = await save({ defaultPath: fileName.trim() });
      if (selected) {
        setDownloadPath(String(selected));
        setMessage('');
        setIsError(false);
      }
    } catch (err: any) {
      setMessage(`Failed to open save dialog: ${err?.message || String(err)}`);
      setIsError(true);
    }
  };

  const handleDownload = async () => {
    const name = fileName.trim();
    if (!name) {
      setMessage('Please enter a file name');
      setIsError(true);
      return;
    }
    if (!downloadPath) {
      setMessage('Please choose a download location first');
      setIsError(true);
      return;
    }

    setIsDownloading(true);
    setMessage('');
    setIsError(false);
    setDownloadPercent(0);
    setDownloaded(0);
    setTotal(0);

    try {
      if (!credentials?.user_id || !credentials?.user_app_key) {
        setMessage('Not logged in or missing credentials');
        setIsError(true);
        return;
      }

      const result = await invoke<string>('download_file', {
        fileName: name,
        outputPath: downloadPath,
        user_id: credentials.user_id,
        user_app_key: credentials.user_app_key,
      });

      setMessage(result || 'Download completed');
      setIsError(false);
      setDownloadPercent(null);
      setDownloaded(0);
      setTotal(0);
      setTimeout(() => {
        setFileName('');
        setDownloadPath('');
        setMessage('');
      }, 2500);
    } catch (err: any) {
      setMessage(err?.message || String(err));
      setIsError(true);
    } finally {
      setIsDownloading(false);
      if (progressEventUnlisten.current) {
        progressEventUnlisten.current();
        progressEventUnlisten.current = null;
      }
    }
  };

  return (
    <div className="card">
      <h3>Download Files From Storage</h3>

      <div className="form-group">
        <label>Remote File Name:</label>
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
            onClick={chooseLocation}
            disabled={!fileName.trim() || isDownloading}
            style={{ minWidth: 120, opacity: (!fileName.trim() || isDownloading) ? 0.5 : 1 }}
          >
            Choose Location
          </button>
          {downloadPath && (
            <span style={{ color: '#e5e5e5', fontSize: '0.9rem', wordBreak: 'break-all' }}>{downloadPath}</span>
          )}
        </div>
        <div style={{ fontSize: '0.8rem', color: '#888', marginTop: 8 }}>
          {downloadPath ? 'File will be saved to the selected location' : 'Please choose where to save the file'}
        </div>
      </div>

      {/* Download Progress Bar */}
      {isDownloading && downloadPercent !== null && (
        <div style={{ margin: '1rem 0' }}>
          <div style={{ height: 18, background: '#222', borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
            <div
              style={{
                width: `${downloadPercent}%`,
                background: '#00cc00',
                height: '100%',
                transition: 'width 0.2s',
              }}
            />
            <span
              style={{
                position: 'absolute',
                left: '50%',
                top: 0,
                transform: 'translateX(-50%)',
                color: '#fff',
                fontSize: '0.9rem',
                fontWeight: 500,
                textShadow: '0 1px 2px #000',
              }}
            >
              {downloadPercent.toFixed(1)}% ({(downloaded / 1024).toFixed(1)} KB / {(total / 1024).toFixed(1)} KB)
            </span>
          </div>
        </div>
      )}

      {message && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.75rem',
            borderRadius: 4,
            background: isError ? '#3a1a1a' : '#1a3a1a',
            border: `1px solid ${isError ? '#cc0000' : '#00cc00'}`,
            color: isError ? '#ffcccc' : '#ccffcc',
          }}
        >
          {message}
        </div>
      )}

      <button
        className="button"
        onClick={handleDownload}
        disabled={!canDownload}
        style={{ opacity: canDownload ? 1 : 0.5, cursor: canDownload ? 'pointer' : 'not-allowed' }}
      >
        {isDownloading ? 'Downloading...' : 'Download File'}
      </button>
    </div>
  );
}

export default FileDownload;
