import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAuth } from '../contexts/AuthContext';
import apiEndpoints from '../api_endpoints.json';
import { List } from './List';

interface PublicLinkEntry {
  remote_path: string;
  link_hash: string;
  created_at: string;
  custom_title?: string;
  custom_description?: string;
}

const Links: React.FC = () => {
  const { credentials } = useAuth();
  const [links, setLinks] = useState<PublicLinkEntry[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const handleHistoryFileClick = (remotePath: string) => {
    setNewFileName(remotePath);
  };

  const fetchLinks = async () => {
    if (!credentials?.user_id) return;
    setLoading(true);
    setError('');
    try {
      const result = await invoke<PublicLinkEntry[]>('list_public_links', {
        userId: credentials.user_id
      });
      setLinks(result);
    } catch (e: any) {
      setError(e.message || 'Failed to load links');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLinks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials?.user_id]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) return;
    setCreating(true);
    setError('');
    const params = {
      userId: credentials?.user_id,
      remotePath: newFileName.trim(),
      customTitle: newTitle.trim(),
      customDescription: newDescription.trim(),
    };
    console.log('Create link params:', params);
    try {
  await invoke('create_public_link', params);
  setNewFileName('');
      setNewTitle('');
      setNewDescription('');
      fetchLinks();
    } catch (e: any) {
      console.error('Create link error:', e);
      let errMsg = 'Failed to create link';
      if (e) {
        if (typeof e === 'string') errMsg = e;
        else if (e.message) errMsg = e.message;
        else errMsg = JSON.stringify(e);
      }
      setError(errMsg);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (link_hash: string) => {
    setLoading(true);
    setError('');
    try {
      await invoke('delete_public_link', {
        userId: credentials?.user_id,
        linkHash: link_hash
      });
      fetchLinks();
    } catch (e: any) {
      setError(e.message || 'Failed to delete link');
    } finally {
      setLoading(false);
    }
  };

  // Filtered and paginated links
  const filteredLinks = links.filter(link => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      link.remote_path.toLowerCase().includes(q) ||
      (link.custom_title || '').toLowerCase().includes(q) ||
      (link.custom_description || '').toLowerCase().includes(q) ||
      link.link_hash.toLowerCase().includes(q)
    );
  });
  const totalPages = Math.max(1, Math.ceil(filteredLinks.length / rowsPerPage));
  const paginatedLinks = filteredLinks.slice((page - 1) * rowsPerPage, page * rowsPerPage);

  React.useEffect(() => { setPage(1); }, [search, rowsPerPage]);

  // copy notification
  const [copiedMsg, setCopiedMsg] = useState<string | null>(null);
  // copy handler
  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMsg(label + ' copied!');
      setTimeout(() => setCopiedMsg(null), 1200);
    } catch (e) {
      setCopiedMsg('Copy failed');
      setTimeout(() => setCopiedMsg(null), 1200);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 32,
        maxWidth: 1200,
        margin: '2rem auto',
        minHeight: 500,
        width: '100%',
      }}
    >
      {/* Top row: Create Public Link (left) and Upload History (right) */}
      <div style={{ display: 'flex', gap: 32, alignItems: 'stretch', height: 420 }}>
        {/* Create Public Link */}
        <div style={{ flex: 1, minWidth: 480, maxWidth: 700, height: '100%' }}>
          <div style={{ border: '2px solid #333', borderRadius: 12, background: '#202127', padding: 24, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', width: '100%' }}>
            <h2 style={{ marginBottom: 0 }}>Create Public Link</h2>
            <form onSubmit={handleCreate} style={{ marginTop: 16 }}>
              <div className="form-group">
                <label>File Name (remote_path)</label>
                <input value={newFileName} onChange={e => setNewFileName(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Title (optional)</label>
                <input value={newTitle} onChange={e => setNewTitle(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Description (optional)</label>
                <input value={newDescription} onChange={e => setNewDescription(e.target.value)} />
              </div>
              <button className="button" type="submit" disabled={creating}>
                {creating ? 'Creating...' : 'Create Link'}
              </button>
            </form>
            {error && (
              <div className="error-message" style={{ marginTop: 12 }}>
                {error}
              </div>
            )}
          </div>
        </div>
        {/* Upload History */}
        <div style={{ flex: 1, minWidth: 480, maxWidth: 700, height: '100%' }}>
          <div style={{ border: '2px solid #333', borderRadius: 12, background: '#202127', padding: 24, height: '100%', display: 'flex', flexDirection: 'column', width: '100%' }}>

            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', width: '100%' }}>
              <List onRemoteFileClick={handleHistoryFileClick} maxHeight={undefined} />
            </div>
          </div>
        </div>
      </div>
      {/* Bottom row: Full-width Public Links Table */}
      <div style={{ width: '100%', marginTop: 16 }}>
        <div style={{ border: '2px solid #333', borderRadius: 12, background: '#202127', padding: 24, marginTop: 0 }}>
          <h3 style={{ margin: '0 0 16px 0' }}>Links Management</h3>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Search links..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ padding: 8, borderRadius: 6, border: '1px solid #444', background: '#191b1f', color: '#fff', minWidth: 180 }}
            />
            <span style={{ marginLeft: 8 }}>Show
              <select value={rowsPerPage} onChange={e => setRowsPerPage(Number(e.target.value))} style={{ margin: '0 8px', padding: '4px 8px', borderRadius: 4 }}>
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              entries
            </span>
          </div>
          {loading ? (
            <div style={{ color: '#aaa', marginTop: 32 }}>Loading...</div>
          ) : (
            <div style={{ overflowX: 'auto', marginTop: 0 }}>
              <table style={{ width: '100%', minWidth: 700, background: '#181818', borderRadius: 8, borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 10, background: 'transparent' }}>Created</th>
                    <th style={{ textAlign: 'left', padding: 10, background: 'transparent' }}>File</th>
                    <th style={{ textAlign: 'left', padding: 10, background: 'transparent' }}>Title</th>
                    <th style={{ textAlign: 'left', padding: 10, background: 'transparent' }}>Hash</th>
                    <th style={{ textAlign: 'left', padding: 10, background: 'transparent' }}>URL</th>
                    <th style={{ width: 80, background: 'transparent' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedLinks.length === 0 ? (
                    <tr><td colSpan={6} style={{ color: '#888', textAlign: 'center', padding: 24 }}>No public links found.</td></tr>
                  ) : paginatedLinks.map(link => {
                    const apiBase = apiEndpoints.api_base_url;
                    const publicUrl = `${apiBase}/publicDownload?hash=${encodeURIComponent(link.link_hash)}&preview=true`;
                    const directUrl = `${apiBase}/publicDownload?hash=${encodeURIComponent(link.link_hash)}`;
                    return (
                      <tr key={link.link_hash} style={{ borderBottom: '1px solid #23272f' }}>
                        {/* Created */}
                        <td style={{ padding: 10, whiteSpace: 'nowrap' }}>
                          {(() => {
                            const d = new Date(link.created_at);
                            const dateStr = d.toLocaleDateString();
                            const timeStr = d.toLocaleTimeString();
                            return <span>{dateStr}<br />{timeStr}</span>;
                          })()}
                        </td>
                        {/* File */}
                        <td style={{ padding: 10, maxWidth: 160, wordBreak: 'break-all' }}>
                          {link.remote_path.length > 32
                            ? <span title={link.remote_path}>{link.remote_path.slice(0, 12)}...{link.remote_path.slice(-12)}</span>
                            : link.remote_path}
                        </td>
                        {/* Title */}
                        <td style={{ padding: 10, maxWidth: 120, wordBreak: 'break-all' }}>{link.custom_title || '-'}</td>
                        {/* Hash */}
                        <td style={{ padding: 10, maxWidth: 120, wordBreak: 'break-all' }}>
                          <span title={link.link_hash}>{link.link_hash.slice(0, 8)}...{link.link_hash.slice(-6)}</span>
                        </td>
                        {/* URL */}
                        <td style={{ padding: 10, maxWidth: 260, wordBreak: 'break-all' }}>
                          <a href={publicUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#ff9800', textDecoration: 'underline', fontSize: 13 }}>{publicUrl}</a>
                        </td>
                        {/* Actions */}
                        <td style={{ padding: 10, display: 'flex', gap: 6 }}>
                          <button
                            className="button"
                            style={{ background: '#1976d2', minWidth: 32, padding: '6px 8px', fontSize: 13 }}
                            title="Copy Preview Link"
                            type="button"
                            onClick={() => handleCopy(publicUrl, 'Preview link')}
                          >
                            Copy Preview
                          </button>
                          <button
                            className="button"
                            style={{ background: '#388e3c', minWidth: 32, padding: '6px 8px', fontSize: 13 }}
                            title="Copy Direct Link"
                            type="button"
                            onClick={() => handleCopy(directUrl, 'Direct link')}
                          >
                            Copy Direct
                          </button>
                          <button className="button" style={{ background: '#c62828', minWidth: 60, padding: '6px 12px' }} onClick={() => handleDelete(link.link_hash)}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {/* Pagination controls */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: 16, gap: 8 }}>
                <button className="button" style={{ minWidth: 32, padding: '4px 10px' }} disabled={page === 1} onClick={() => setPage(page - 1)}>Prev</button>
                <span style={{ color: '#ccc' }}>Page {page} of {totalPages}</span>
                <button className="button" style={{ minWidth: 32, padding: '4px 10px' }} disabled={page === totalPages} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            {/* Copy notification */}
            {copiedMsg && (
              <div style={{ position: 'fixed', top: 24, right: 32, background: '#222', color: '#fff', padding: '10px 24px', borderRadius: 8, zIndex: 9999, boxShadow: '0 2px 8px #0008', fontSize: 16, transition: 'opacity 0.2s' }}>
                {copiedMsg}
              </div>
            )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Links;
