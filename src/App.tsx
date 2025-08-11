import React, { useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AuthManager } from './components/AuthManager';
import UploadDownload from './pages/Dashboard';
import { Wallet } from './components/Wallet';
import { AccountSection } from './components/AccountSection';
import { Sidebar } from './components/Sidebar';
import Links from './components/Links';
import { DownloadSelectionProvider } from './contexts/DownloadSelectionContext';
import GlobalUploadProgressBar from './components/GlobalUploadProgressBar';

const HEADER_H = 70;      // right header height
const SIDEBAR_W = 180;    // sidebar width (match Sidebar)

const MainContent: React.FC = () => {
  const { isAuthenticated, credentials } = useAuth();
  const [page, setPage] = useState('upload-download');

  if (!isAuthenticated) {
    return <AuthManager />;
  }

  let content: React.ReactNode = null;
  if (page === 'upload-download') content = <UploadDownload />;
  else if (page === 'wallet') content = <Wallet />;
  else if (page === 'links') content = <Links />;
  else if (page === 'account') content = <AccountSection />;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#181818' }}>
      {/* Full header to left */}
      <header
        className="header"
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          top: 0,
          height: HEADER_H,
          background: '#0f1115',
          borderBottom: '1px solid #23272f',
          display: 'flex',
          alignItems: 'center',
          zIndex: 200,
          boxSizing: 'border-box',
          paddingRight: 24,
        }}
      >
        <div
          className="header-content"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            padding: '0 24px 0 18px',
            boxSizing: 'border-box',
          }}
        >
          {/* Left header use logo */}
          <img src="https://us-west-00-firestarter.pipenetwork.com/publicDownload?hash=257ebacfdac50be1a0075ce46a446149" alt="Firestarter Logo" style={{ height: 32, marginRight: 20 }} />
          <h1 style={{ margin: 0, fontSize: 18, color: '#e6e6e6', flex: 1 }}>Firestarter</h1>
          <div className="header-info" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="header-subtitle" style={{ color: '#9aa0a6', fontSize: 13 }}>
              Firestarter Storage
            </span>
            {credentials?.username && (
              <span
                className="user-welcome"
                style={{
                  background: '#2a2f39',
                  color: '#e6e6e6',
                  borderRadius: 12,
                  padding: '4px 10px',
                  fontSize: 12,
                  maxWidth: 220,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: 'inline-block',
                }}
                title={`Welcome, ${credentials.username}`}
              >
                Welcome, {credentials.username}
              </span>
            )}
          </div>
        </div>
      </header>
      {/* Sidebar starts from below header, without filler/brand */}
      <Sidebar active={page} onNavigate={setPage} topOffset={HEADER_H} />
      {/* Main content on the right, paddingTop to avoid being covered by header */}
      <div style={{ flex: 1, marginLeft: SIDEBAR_W, paddingTop: HEADER_H }}>
        <main className="main-content" style={{ padding: 16 }}>
          {content}
        </main>
      </div>
    </div>
  );
};

import { UploadProvider } from './contexts/UploadContext';

function App() {
  React.useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    window.addEventListener('contextmenu', handleContextMenu);
    return () => {
      window.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);
  return (
    <AuthProvider>
      <UploadProvider>
        <GlobalUploadProgressBar />
        <DownloadSelectionProvider>
          <MainContent />
        </DownloadSelectionProvider>
      </UploadProvider>
    </AuthProvider>
  );
}

export default App;
