import React, { createContext, useContext, useState, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
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
}

const UploadContext = createContext<UploadContextType | undefined>(undefined);

export const useUpload = () => {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error('useUpload must be used within UploadProvider');
  return ctx;
};

export const UploadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const uploadRefs = useRef<{ [id: string]: { cancelled: boolean } }>({});
  const { credentials, getValidAccessToken } = useAuth();

  const startUpload = useCallback(async (filePath: string, remoteFileName: string, tier?: string, epochs?: string) => {
    const id = `${filePath}-${Date.now()}`;
    // check if file exists
    const newTask: UploadTask = {
      id, filePath, remoteFileName, status: 'uploading', progress: 0, uploadedSize: 0, totalSize: 0
    };
    setTasks(tasks => [...tasks, newTask]);
    uploadRefs.current[id] = { cancelled: false };

    let unlisten: (() => void) | null = null;
    try {
      // Listen progress event
      unlisten = await listen<any>('upload_progress', (event) => {
        if (!event.payload) return;
        if (typeof event.payload === 'number') {
          setTasks(tasks => tasks.map(t => t.id === id ? { ...t, progress: event.payload } : t));
        } else if (typeof event.payload === 'object') {
          setTasks(tasks => tasks.map(t => t.id === id ? {
            ...t,
            progress: event.payload.percent ?? t.progress,
            uploadedSize: event.payload.uploaded ?? t.uploadedSize,
            totalSize: event.payload.total ?? t.totalSize
          } : t));
        }
      });

      // ensure valid JWT
      const token = await getValidAccessToken();
      if (!token || !credentials?.user_id) {
        setTasks(tasks => tasks.map(t => t.id === id ? { ...t, status: 'error', error: 'Not logged in or JWT expired' } : t));
        return;
      }

      await invoke('upload_file', {
        filePath,
        remoteFileName,
        userId: credentials.user_id,
        tier,
        epochs: epochs ? Number(epochs) : undefined,
      });
      setTasks(tasks => tasks.map(t => t.id === id ? { ...t, status: 'success', progress: 100, message: 'Upload complete' } : t));
    } catch (err: any) {
      setTasks(tasks => tasks.map(t => t.id === id ? { ...t, status: 'error', error: err?.toString() || 'Upload failed' } : t));
    } finally {
      if (unlisten) unlisten();
    }
  }, [credentials, getValidAccessToken]);

  const cancelUpload = useCallback((id: string) => {
    uploadRefs.current[id] = { cancelled: true };
  }, []);

  return (
    <UploadContext.Provider value={{ tasks, startUpload, cancelUpload }}>
      {children}
    </UploadContext.Provider>
  );
};
