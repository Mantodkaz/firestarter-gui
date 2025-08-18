import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useAuth } from './AuthContext';

interface UploadTask {
  id: string;
  filePath: string;
  remoteFileName: string;
  status: 'idle' | 'uploading' | 'success' | 'error' | 'cancelled';
  progress: number;      // 0-100
  uploadedSize: number;  // cumulative bytes
  totalSize: number;     // total file bytes
  speedBps?: number;     // EMA bytes/sec
  etaSec?: number;       // window seconds
  message?: string;
  error?: string;
}

interface UploadContextType {
  tasks: UploadTask[];
  startUpload: (
    filePath: string,
    remoteFileName: string,
    tier?: string,
    epochs?: string,
  ) => void;
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
      percent?: number;       // 0..100 or 0..1
      uploaded?: number;      // bytes
      total?: number;         // total file size
      completed?: boolean;    // true on final event
      status?: string;
      message?: string;
      error?: string;
    };

// clamp 0..100
function clampPercent(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return p < 0 ? 0 : p > 100 ? 100 : p;
}

// Prefer ratio of uploaded/total; fallback to provided percent
function normalizePercent(p?: number, uploaded?: number, total?: number): number | undefined {
  if (typeof uploaded === 'number' && typeof total === 'number' && total > 0) {
    return clampPercent((uploaded / total) * 100);
  }
  if (typeof p === 'number') {
    return clampPercent(p <= 1 ? p * 100 : p);
  }
  return undefined;
}

type RuntimeRef = {
  cancelled: boolean;
  accBytes: number;
  lastSeenBytes: number;
  lastTs: number;            // ms 
  emaBps: number | null;
  ring: Array<{ t: number; b: number }>; // 10s (t=sec, b=uploaded cum)
  warmSamples: number;
};

const WINDOW_SEC = 10;           // rolling window for ETA
const MIN_DT = 0.08;             // minimal 80ms for stability
const WARM_MIN_SAMPLES = 3;      // requires >=3 samples
const WARM_MIN_BYTES = 1 * 1024 * 1024; // minimal 1MB sent before ETA shows
const FREEZE_REMAIN = 2 * 1024 * 1024;  // freeze ETA <1s when nearly done
const EMA_ALPHA = 0.1;           // 10% new sample

export const UploadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const { credentials } = useAuth();

  // Per-task runtime refs
  const refs = useRef<Record<string, RuntimeRef>>({});
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const resetTasks = useCallback(() => {
    setTasks([]);
    refs.current = {};
  }, []);

  useEffect(() => {
    resetTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials?.user_id]);

  // Attach upload_progress listener once
  useEffect(() => {
    let mounted = true;

    (async () => {
      if (unlistenRef.current) return;
      unlistenRef.current = await listen<UploadProgressPayload>('upload_progress', (event) => {
        if (!mounted) return;
        const payload = event.payload;

        setTasks((prev) => {
          if (typeof payload === 'number') {
            const rIdx = [...prev].reverse().findIndex((t) => t.status === 'uploading');
            if (rIdx === -1) return prev;
            const pos = prev.length - 1 - rIdx;
            const cur = prev[pos];
            const r = refs.current[cur.id];
            if (r?.cancelled) return prev;
            const p = clampPercent(payload <= 1 ? payload * 100 : payload);
            const next = [...prev];
            next[pos] = { ...cur, progress: p };
            return next;
          }

          if (!payload || typeof payload !== 'object') return prev;

          const { id, percent, uploaded, total, completed, status, message, error } = payload;

          // target task
          const pos = id
            ? prev.findIndex((t) => t.id === id)
            : (() => {
                const rIdx = [...prev].reverse().findIndex((t) => t.status === 'uploading');
                return rIdx === -1 ? -1 : prev.length - 1 - rIdx;
              })();
          if (pos === -1) return prev;

          const cur = prev[pos];
          let r = refs.current[cur.id];
          if (r?.cancelled) return prev;
          if (!r) {
            r = refs.current[cur.id] = {
              cancelled: false,
              accBytes: 0,
              lastSeenBytes: 0,
              lastTs: performance.now(),
              emaBps: null,
              ring: [],
              warmSamples: 0,
            };
          }

          // total size
          let totalBytes = cur.totalSize;
          if (typeof total === 'number' && total > 0) totalBytes = total;
          let cumUploaded = cur.uploadedSize;
          if (typeof uploaded === 'number' && uploaded >= 0) {
            if (uploaded < r.lastSeenBytes) {
              r.accBytes += r.lastSeenBytes;
              r.lastSeenBytes = uploaded;
            } else {
              r.lastSeenBytes = uploaded;
            }
            const nowBytes = r.accBytes + r.lastSeenBytes;
            cumUploaded = Math.max(cur.uploadedSize, nowBytes);
          }

          const nowTs = performance.now();
          const dt = Math.max(MIN_DT, (nowTs - r.lastTs) / 1000);
          const prevCum = cur.uploadedSize;
          const effDelta = Math.max(0, cumUploaded - prevCum);
          r.warmSamples += 1;

          const instBps = effDelta / dt;
          r.emaBps = r.emaBps == null ? instBps : (r.emaBps * (1 - EMA_ALPHA) + instBps * EMA_ALPHA);
          r.lastTs = nowTs;

          const tSec = nowTs / 1000;
          r.ring.push({ t: tSec, b: cumUploaded });
          const cutoff = tSec - WINDOW_SEC;
          while (r.ring.length && r.ring[0].t < cutoff) r.ring.shift();

          let avgBps: number | null = null;
          if (r.ring.length >= 2) {
            const first = r.ring[0], last = r.ring[r.ring.length - 1];
            const dT = Math.max(0.5, last.t - first.t);
            const dB = Math.max(0, last.b - first.b);
            avgBps = dB / dT;
          }

          // window average > EMA > null
          const estimator =
            (avgBps && isFinite(avgBps) && avgBps > 0 ? avgBps :
             (r.emaBps && isFinite(r.emaBps) && r.emaBps > 0 ? r.emaBps : null));

          const warmedUp = (r.warmSamples >= WARM_MIN_SAMPLES) && (cumUploaded >= WARM_MIN_BYTES);

          // clamp estimator
          let etaSec: number | undefined;
          let speedBps: number | undefined = r.emaBps ?? undefined;

          if (warmedUp && estimator && totalBytes > 0) {
            const s = Math.min(Math.max(estimator, 1024 /*1KB/s*/), 10 * 1024 * 1024 * 1024 /*10GB/s*/);
            const remain = Math.max(0, totalBytes - cumUploaded);
            etaSec = remain / s;

            // freeze near-finish
            const pct = totalBytes > 0 ? (cumUploaded / totalBytes) : 0;
            if (remain < FREEZE_REMAIN || pct >= 0.995) {
              etaSec = 1;
            }
          }

          const viewPercent = normalizePercent(percent, cumUploaded, totalBytes);
          const isCompletedFlag = completed === true || status === 'completed';
          const doneByBytes = totalBytes > 0 && cumUploaded >= totalBytes;

          const nextTask: UploadTask = {
            ...cur,
            progress: typeof viewPercent === 'number' ? viewPercent : cur.progress,
            uploadedSize: Number.isFinite(cumUploaded) ? cumUploaded : cur.uploadedSize,
            totalSize: Number.isFinite(totalBytes) ? totalBytes : cur.totalSize,
            speedBps: Number.isFinite(speedBps as number) ? speedBps : cur.speedBps,
            etaSec: typeof etaSec === 'number' && isFinite(etaSec) ? etaSec : cur.etaSec,
            message: message ?? cur.message,
            error: error ?? cur.error,
            status: error ? 'error' : (isCompletedFlag || doneByBytes) ? 'success' : cur.status,
          };

          if (nextTask.status === 'success' && cur.status !== 'success') {
            try {
              window.dispatchEvent(
                new CustomEvent('upload:completed', {
                  detail: {
                    id: nextTask.id,
                    filePath: nextTask.filePath,
                    name: nextTask.remoteFileName,
                    total: nextTask.totalSize,
                  },
                })
              );
            } catch {
              // no-op
            }
          }

          const out = [...prev];
          out[pos] = nextTask;
          return out;
        });
      });
    })();

    return () => {
      let u = unlistenRef.current;
      unlistenRef.current = null;
      if (u) u();
      mounted = false;
    };
  }, []);

  const startUpload = useCallback(
    async (filePath: string, remoteFileName: string, tier?: string, epochs?: string) => {
      const id = `${filePath}-${Date.now()}`;

      setTasks((prev) => [
        ...prev,
        { id, filePath, remoteFileName, status: 'uploading', progress: 0, uploadedSize: 0, totalSize: 0 },
      ]);
      refs.current[id] = {
        cancelled: false,
        accBytes: 0,
        lastSeenBytes: 0,
        lastTs: performance.now(),
        emaBps: null,
        ring: [],
        warmSamples: 0,
      };

      try {
        if (!credentials?.user_id || !credentials?.user_app_key) {
          setTasks((prev) =>
            prev.map((t) => (t.id === id ? { ...t, status: 'error', error: 'Not logged in or missing credentials' } : t))
          );
          return;
        }

        await invoke('upload_file', {
          id,
          filePath,
          remoteFileName,
          tier,
          epochs: epochs ? Number(epochs) : undefined,
        });

      } catch (err: any) {
        setTasks((prev) =>
          prev.map((t) => (t.id === id ? { ...t, status: 'error', error: String(err || 'Upload failed') } : t))
        );
      }
    },
    [credentials?.user_id, credentials?.user_app_key]
  );

  const cancelUpload = useCallback((id: string) => {
    const r = refs.current[id];
    if (r) r.cancelled = true;
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: 'cancelled', message: 'Upload cancelled by user' } : t))
    );
    // void invoke('cancel_upload', { id }).catch(() => {});
  }, []);

  return (
    <UploadContext.Provider value={{ tasks, startUpload, cancelUpload, resetTasks }}>
      {children}
    </UploadContext.Provider>
  );
};
