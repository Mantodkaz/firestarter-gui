import React, { createContext, useContext, useState } from 'react';

export interface DownloadSelection {
  remotePath: string;
  fileName?: string;
}

interface DownloadSelectionContextType {
  selection: DownloadSelection | null;
  setSelection: (sel: DownloadSelection | null) => void;
}

const DownloadSelectionContext = createContext<DownloadSelectionContextType | undefined>(undefined);

export const useDownloadSelection = () => {
  const ctx = useContext(DownloadSelectionContext);
  if (!ctx) throw new Error('useDownloadSelection must be used within DownloadSelectionProvider');
  return ctx;
};

export const DownloadSelectionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selection, setSelection] = useState<DownloadSelection | null>(null);
  return (
    <DownloadSelectionContext.Provider value={{ selection, setSelection }}>
      {children}
    </DownloadSelectionContext.Provider>
  );
};
