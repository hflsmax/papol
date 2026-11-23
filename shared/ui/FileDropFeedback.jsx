import React from 'react';

// A file held over a window that takes it, and what became of a drop it
// could not take (shared/fileDropStyles.js).
// `into` is 'project' while a project page takes the drop itself.
export default function DeskFileDropFeedback({ state, message, opensViewer = false, folders = true, into = null }) {
  return <>
    {state && (
      <div className={`desk-file-drop-overlay${state === 'reject' ? ' reject' : ''}`} role="status">
        <div className="desk-file-drop-card">
          <strong>{state === 'reject'
            ? 'PDF files only'
            : into === 'project' ? 'Drop PDFs to add to this project'
            : opensViewer ? 'Drop PDF to open' : folders ? 'Drop PDFs or a folder to import' : 'Drop PDFs to import'}</strong>
          <span>{state === 'reject'
            ? 'Papol’s Desk only supports PDF files.'
            : into === 'project'
              ? 'They go to your nook and into the project together.'
            : opensViewer
              ? 'The paper will open in Papol’s PDF viewer.'
              : 'Papers open for review before they are added.'}</span>
        </div>
      </div>
    )}
    {message && <div className="desk-file-drop-notice" role="alert">{message}</div>}
  </>;
}
