import React, { useMemo } from 'react';

interface SidebarProps {
  active: string;
  onNavigate: (page: string) => void;
  /** Height in px of fixed header at top. sidebar starts below it. */
  topOffset?: number;
}

const MENU: Array<{ id: string; label: string }> = [
  { id: 'upload-download', label: 'Upload/Download' },
  { id: 'wallet', label: 'Wallet' },
  { id: 'links', label: 'Links' },
  { id: 'account', label: 'Account' },
];

export const Sidebar: React.FC<SidebarProps> = ({ active, onNavigate, topOffset = 0 }) => {
  const sidebarStyle = useMemo(() => ({
    top: `${topOffset}px`,
    height: `calc(100vh - ${topOffset}px)`,
  }), [topOffset]);

  return (
    <nav
      className="sidebar"
      aria-label="Primary"
      style={{
        position: 'fixed',
        left: 0,
        ...sidebarStyle,
        width: 180,
        background: '#191b1f',
        color: '#e3e3e3',
        boxSizing: 'border-box',
        borderRight: '1px solid #23272f',
        zIndex: 100,
        fontFamily: 'Inter, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        padding: 0,
      }}
    >
      <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 12, gap: 6, display: 'flex', flexDirection: 'column', flex: 1 }}>
        {MENU.map((item) => {
          const isActive = active === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onNavigate(item.id)}
                aria-current={isActive ? 'page' : undefined}
                style={{
                  width: '100%',
                  background: isActive ? '#23272f' : 'transparent',
                  color: isActive ? '#ffb300' : '#e3e3e3',
                  border: '1px solid transparent',
                  textAlign: 'left',
                  padding: '10px 14px',
                  fontSize: 14,
                  fontWeight: 500,
                  borderRadius: 8,
                  cursor: 'pointer',
                  transition: 'background 120ms, color 120ms',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = '#20232a';
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'transparent';
                }}
              >
                {item.label}
              </button>
            </li>
          );
        })}
      </ul>

      <div
        style={{
          padding: '10px 0',
          textAlign: 'center',
          color: '#888',
          fontSize: 11,
          letterSpacing: 0.5,
          borderTop: '1px solid #23272f',
          userSelect: 'none',
        }}
      >
        Pipe Network © 2025
      </div>
    </nav>
  );
};
