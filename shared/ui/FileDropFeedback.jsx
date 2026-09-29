import React from 'react';

// A file held over a window that takes it, and what became of a drop it
// could not take (shared/fileDropStyles.js).
export default function DeskFileDropFeedback({ state, message, opensViewer = false, folders = true }) {
  return <>
    {state && (
      <div className={`desk-file-drop-overlay${state === 'reject' ? ' reject' : ''}`} role="status">
        <div className="desk-file-drop-card">
          <strong>{state === 'reject'
            ? 'PDF files only'
            : opensViewer ? 'Drop PDF to open' : folders ? 'Drop PDFs or a folder to import' : 'Drop PDFs to import'}</strong>
          <span>{state === 'reject'
            ? 'Papol’s Desk only supports PDF files.'
            : opensViewer
              ? 'The paper will open in Papol’s PDF viewer.'
              : 'Papers open for review before they are added.'}</span>
        </div>
      </div>
    )}
    {message && <div className="desk-file-drop-notice" role="alert">{message}</div>}
  </>;
}
