import React from 'react';

interface SidebarProps {
  active: string;
  onNavigate: (page: string) => void;
  /** header height is fixed at top (px). sidebar will start below this header. */
  topOffset?: number;
}

const menu = [
  { id: 'upload-download', label: 'Upload/Download' },
  { id: 'wallet', label: 'Wallet' },
  { id: 'links', label: 'Links' },
  { id: 'account', label: 'Account' },
];

export const Sidebar: React.FC<SidebarProps> = ({ active, onNavigate, topOffset = 0 }) => {
  const sidebarTop = `${topOffset}px`;
  const sidebarHeight = `calc(100vh - ${topOffset}px)`;

  return (
    <nav
      className="sidebar"
      style={{
        position: 'fixed',
        left: 0,
        top: sidebarTop,
        height: sidebarHeight,
        width: 170,
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
      {/* Sidebar menu */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
        <ul style={{ listStyle: 'none', margin: 0, padding: 16, flex: 1 }}>
          {menu.map((item) => {
            const isActive = active === item.id;
            return (
              <li key={item.id}>
                <button
                  onClick={() => onNavigate(item.id)}
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
                  onMouseOver={(e) => {
                    if (!isActive) e.currentTarget.style.background = '#20232a';
                  }}
                  onMouseOut={(e) => {
                    if (!isActive) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Footer */}
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
