import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useAuth } from './AuthContext';

interface UploadTask {
  id: string;
  filePath: string;
  remoteFileName: string;
  status: 'idle' | 'uploading' | 'success' | 'error' | 'cancelled';
  progress: number; // 0-100
  uploadedSize: number;
  totalSize: number;
  message?: string;
  error?: string;
}

interface UploadContextType {
  tasks: UploadTask[];
  startUpload: (filePath: string, remoteFileName: string, tier?: string, epochs?: string) => void;
  cancelUpload: (id: string) => void;
  resetTasks: () => void;
}

const UploadContext = createContext<UploadContextType | undefined>(undefined);

export const useUpload = () => {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error('useUpload must be used within UploadProvider');
  return ctx;
};

 type UploadProgressPayload =
  | number
  | {
      id?: string;
      percent?: number; // 0..100
      uploaded?: number; // bytes
      total?: number; // bytes
    };

export const UploadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const uploadRefs = useRef<Record<string, { cancelled: boolean }>>({});
  const { credentials, getValidAccessToken } = useAuth();
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Reset upload tasks
  const resetTasks = useCallback(() => {
    setTasks([]);
    uploadRefs.current = {};
  }, []);

  // Reset upload state when credentials change (account switch)
  useEffect(() => {
    resetTasks();
  }, [credentials, resetTasks]);

  useEffect(() => {
    // Attach once
    const attach = async () => {
      if (unlistenRef.current) return;
      unlistenRef.current = await listen<UploadProgressPayload>('upload_progress', (event) => {
        const payload = event.payload;
        setTasks((prev) => {
          if (typeof payload === 'number') {
            // Fallback: broadcast numeric percent to the most recent uploading task
            const idx = [...prev].reverse().findIndex((t) => t.status === 'uploading');
            if (idx === -1) return prev;
            const realIdx = prev.length - 1 - idx;
            const t = prev[realIdx];
            if (uploadRefs.current[t.id]?.cancelled) return prev;
            const next = [...prev];
            next[realIdx] = { ...t, progress: Math.min(100, Math.max(0, payload)) };
            return next;
          }
          
          if (payload && typeof payload === 'object') {
            const { id, percent, uploaded, total } = payload;
            const pos = id
              ? prev.findIndex((t) => t.id === id)
              : (() => {
                  const rIdx = [...prev].reverse().findIndex((t) => t.status === 'uploading');
                  return rIdx === -1 ? -1 : prev.length - 1 - rIdx;
                })();

            if (pos === -1) return prev;
            const cur = prev[pos];
            if (uploadRefs.current[cur.id]?.cancelled) return prev;

            const next = [...prev];
            next[pos] = {
              ...cur,
              progress: percent ?? cur.progress,
              uploadedSize: uploaded ?? cur.uploadedSize,
              totalSize: total ?? cur.totalSize,
            };
            return next;
          }


          return prev;
        });
      });
    };

    attach();
    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, []);

  const startUpload = useCallback(
    async (filePath: string, remoteFileName: string, tier?: string, epochs?: string) => {
      const id = `${filePath}-${Date.now()}`; // local identifier to correlate events
      setTasks((prev) => [
        ...prev,
        { id, filePath, remoteFileName, status: 'uploading', progress: 0, uploadedSize: 0, totalSize: 0 },
      ]);
      uploadRefs.current[id] = { cancelled: false };

      try {
        // Ensure user & token are valid before invoking upload
        const token = await getValidAccessToken();
        if (!token || !credentials?.user_id) {
          setTasks((prev) =>
            prev.map((t) => (t.id === id ? { ...t, status: 'error', error: 'Not logged in or JWT expired' } : t))
          );
          return;
        }

          await invoke('upload_file', {
            filePath: filePath,
            remoteFileName: remoteFileName,
            tier,
            epochs: epochs ? Number(epochs) : undefined,
          });

        setTasks((prev) =>
          prev.map((t) =>
            t.id === id
              ? uploadRefs.current[id]?.cancelled
                ? { ...t, status: 'cancelled', message: 'Upload cancelled' }
                : { ...t, status: 'success', progress: 100, message: 'Upload complete' }
              : t
          )
        );
      } catch (err: any) {
        setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: 'error', error: String(err || 'Upload failed') } : t)));
      }
    },
    [credentials, getValidAccessToken]
  );

  const cancelUpload = useCallback((id: string) => {
    uploadRefs.current[id] = { cancelled: true };
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: 'cancelled', message: 'Upload cancelled by user' } : t)));
  }, []);

  return (
  <UploadContext.Provider value={{ tasks, startUpload, cancelUpload, resetTasks }}>{children}</UploadContext.Provider>
  );
};
