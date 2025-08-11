// import React, { useState, useEffect } from 'react';
import { useState, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useAuth } from '../contexts/AuthContext';
import { useUpload } from '../contexts/UploadContext';

// Format bytes (B, KB, MB, GB, xx)
function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

interface FileUploadProps {
	onUploadSuccess?: () => void;
}

function FileUpload({ onUploadSuccess }: FileUploadProps) {
	const { credentials } = useAuth();
	const { tasks, startUpload, cancelUpload } = useUpload();
	const [filePath, setFilePath] = useState<string | null>(null);
	const [remoteFileName, setRemoteFileName] = useState('');
	const tierList = [
		{ value: 'normal', label: 'Normal' },
		{ value: 'priority', label: 'Priority' },
		{ value: 'premium', label: 'Premium' },
		{ value: 'ultra', label: 'Ultra' },
		{ value: 'enterprise', label: 'Enterprise' }
	];
	const [selectedTier, setSelectedTier] = useState('normal');
	const [epochs, setEpochs] = useState('1');

	// Open Tauri dialog to choose file
	const handleChooseFile = async () => {
	// clear error/message (no need anymore, it's already handled context)
		try {
			const selected = await open({ multiple: false, directory: false });
			if (typeof selected === 'string') {
				setFilePath(selected);
				// Always set remoteFileName to local file name every time a new file is selected
				const parts = selected.split(/[/\\]/);
				setRemoteFileName(parts[parts.length - 1]);
			} else {
				setFilePath(null);
				setRemoteFileName('');
			}
		} catch (err) {
			alert('Failed to open file dialog');
		}
	};

	// Helper to get file name from path (cross-platform, without path.basename)
	const getFileNameForServer = () => {
		if (remoteFileName && remoteFileName.trim() !== '') {
			return remoteFileName.trim();
		}
		if (filePath) {
			// Get file name from path string (Windows/Linux/Mac)
			const parts = filePath.split(/[/\\]/);
			return parts[parts.length - 1];
		}
		return '';
	};

	 const handleUpload = () => {
		 if (!filePath || !credentials?.user_id) {
			 alert('No file selected or not logged in');
			 return;
		 }
		 const fileNameForServer = getFileNameForServer();
		 // Pass tier and epochs to startUpload
		 startUpload(filePath, fileNameForServer, selectedTier, epochs);
		 setFilePath(null);
		 setRemoteFileName('');
	 };

	 // Get latest upload task (or currently running task) for this file
	 const currentTask = tasks.length > 0 ? tasks[tasks.length - 1] : null;
	 const isUploading = !!currentTask && currentTask.status === 'uploading';

	 // Call onUploadSuccess only after upload is truly successful
	 useEffect(() => {
		 if (currentTask && currentTask.status === 'success') {
			 if (onUploadSuccess) onUploadSuccess();
		 }
		 // eslint-disable-next-line react-hooks/exhaustive-deps
	 }, [currentTask && currentTask.status]);
	return (
		<div className="card">
			<h2>Upload File</h2>
			<div className="form-group" style={{ marginBottom: 16 }}>
				<label htmlFor="fileInput" style={{ color: '#ccc', marginBottom: 6, display: 'block' }}>File</label>
				<button className="button" style={{ width: '100%' }} onClick={handleChooseFile} disabled={isUploading}>
					{filePath ? `📄 ${filePath}` : 'Choose File...'}
				</button>
			</div>
			<div className="form-group" style={{ marginBottom: 16 }}>
				<label htmlFor="remoteFileNameInput" style={{ color: '#ccc', marginBottom: 6, display: 'block' }}>Remote File Name (optional)</label>
				<input
					id="remoteFileNameInput"
					type="text"
					value={remoteFileName}
					onChange={e => setRemoteFileName(e.target.value)}
					disabled={isUploading}
					placeholder="Leave blank to use local file name"
					style={{
						width: '100%',
						background: '#181818',
						color: '#fff',
						border: '1px solid #444',
						borderRadius: 6,
						padding: '8px 12px',
						fontSize: 16
					}}
				/>
			</div>
			<div className="form-group" style={{ marginBottom: 16 }}>
				<label htmlFor="tierSelect" style={{ color: '#ccc', marginBottom: 6, display: 'block' }}>Tier</label>
				<select
					id="tierSelect"
					value={selectedTier}
					onChange={e => setSelectedTier(e.target.value)}
					disabled={isUploading}
					style={{
						width: '100%',
						background: '#181818',
						color: '#fff',
						border: '1px solid #444',
						borderRadius: 6,
						padding: '8px 12px',
						fontSize: 16
					}}
				>
					{tierList.map(tier => (
						<option key={tier.value} value={tier.value}>{tier.label}</option>
					))}
				</select>
			</div>
			<div className="form-group" style={{ marginBottom: 16 }}>
				<label htmlFor="epochsInput" style={{ color: '#ccc', marginBottom: 6, display: 'block' }}>Epochs</label>
				<input
					id="epochsInput"
					type="number"
					min={1}
					value={epochs}
					onChange={e => setEpochs(e.target.value)}
					disabled={isUploading}
					style={{
						width: '100%',
						background: '#181818',
						color: '#fff',
						border: '1px solid #444',
						borderRadius: 6,
						padding: '8px 12px',
						fontSize: 16
					}}
				/>
			</div>
			<button
				className="button"
				style={{ width: '100%', background: '#ff6600', color: '#fff', fontWeight: 600, fontSize: 18, marginBottom: 12 }}
				onClick={handleUpload}
				disabled={isUploading || !filePath}
			>
				{isUploading ? 'Uploading...' : 'Upload'}
			</button>
			{currentTask && (
				<div style={{ marginTop: 12 }}>
					<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 4, fontSize: 15, color: '#ccc', fontWeight: 500 }}>
						<span style={{ fontSize: 18, fontWeight: 700 }}>
							{currentTask.progress !== null ? `${currentTask.progress.toFixed(0)}%` : ''}
						</span>
						<span>
							{currentTask.uploadedSize !== null && currentTask.totalSize !== null
								? `${formatBytes(currentTask.uploadedSize)} / ${formatBytes(currentTask.totalSize)}`
								: ''}
						</span>
						{currentTask.status === 'success' && <span style={{ color: '#4caf50' }}>✅ Upload successful!</span>}
						{currentTask.status === 'error' && <span style={{ color: '#ff4d4f' }}>Upload failed: {currentTask.error || currentTask.message}</span>}
						{currentTask.status === 'cancelled' && <span style={{ color: '#ffb300' }}>Upload cancelled</span>}
					</div>
					<div style={{
						width: '100%',
						height: 12,
						background: '#222',
						borderRadius: 6,
						overflow: 'hidden',
					}}>
						<div style={{
							width: currentTask.progress !== null ? `${currentTask.progress}%` : '0%',
							height: '100%',
							background: 'linear-gradient(90deg, #ff6600 60%, #ffb300 100%)',
							transition: 'width 0.3s cubic-bezier(.4,2,.6,1)',
						}} />
					</div>
					{currentTask.status === 'uploading' && (
						<button className="button" style={{ marginTop: 8, background: '#444', color: '#fff', fontSize: 14 }} onClick={() => cancelUpload(currentTask.id)}>
							Cancel Upload
						</button>
					)}
				</div>
			)}
		</div>
	);
}


export default FileUpload;