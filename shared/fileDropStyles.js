// A file held over a window that takes it (ui/FileDropFeedback.jsx): the
// Desk's pages and the viewer alike.
export const fileDropStyles = `
.desk-file-drop-overlay {
  position: fixed;
  z-index: 1000;
  inset: 16px;
  display: grid;
  place-items: center;
  border: 2px dashed var(--accent);
  border-radius: 16px;
  background: color-mix(in srgb, var(--accent-soft) 88%, transparent);
  color: var(--accent);
  font-family: var(--font-ui);
  pointer-events: none;
  backdrop-filter: blur(2px);
}

.desk-file-drop-overlay.reject {
  border-color: var(--red);
  background: color-mix(in srgb, var(--red-soft) 90%, transparent);
  color: var(--red);
}

.desk-file-drop-card {
  display: grid;
  justify-items: center;
  gap: 7px;
  max-width: min(420px, calc(100vw - 64px));
  padding: 24px 30px;
  border: 1px solid currentColor;
  border-radius: var(--radius);
  background: var(--card);
  box-shadow: 0 12px 32px rgba(29,33,41,.18);
  text-align: center;
}

.desk-file-drop-card strong { font-size: var(--fs-lg); }
.desk-file-drop-card span { color: var(--ink-soft); font-size: var(--fs-sm); }
.desk-file-drop-notice {
  position: fixed;
  z-index: 1000;
  right: 20px;
  bottom: 20px;
  max-width: min(420px, calc(100vw - 40px));
  padding: 10px 14px;
  border: 1px solid var(--red);
  border-radius: var(--radius);
  background: var(--card);
  color: var(--red);
  box-shadow: 0 8px 24px rgba(29,33,41,.18);
  font: var(--fs-sm) var(--font-ui);
}
`;
