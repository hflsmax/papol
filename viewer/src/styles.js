// The viewer is a separate app, so it carries its own copy of Papol's
// tokens rather than importing across the boundary. Values must match
// frontend/DESIGN.md — a reader crossing from a paper page into the viewer
// should not feel they have left.
export const styles = `
:root {
  --font-serif: Georgia, 'Times New Roman', serif;
  --font-ui: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;

  --ink: #1d2129;
  --ink-soft: #4d5561;
  --ink-faint: #7e8794;
  --paper: #f5f6f8;
  --paper-sunken: #f1f3f6;
  --card: #ffffff;
  --line: #dde2e8;
  --line-strong: #b4becb;
  --ink-inverse: #ffffff;
  --accent: #2b4a6f;
  --accent-strong: #1e3752;
  --accent-soft: #eaeff5;
  --gold-ink: #7a5b1e;
  --gold-soft: #faf3e3;
  --gold-line: #e8d9b5;
  --red: #8c2f22;
  --red-soft: #f9ecea;
  --red-line: #e5c4bd;

  --fs-2xs: 0.7rem;
  --fs-xs: 0.78rem;
  --fs-sm: 0.85rem;
  --fs-md: 0.92rem;
  --fs-base: 0.95rem;
  --fs-lg: 1.05rem;
  --radius: 3px;
  --radius-pill: 999px;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: var(--font-serif);
  background: var(--paper);
  color: var(--ink);
  line-height: 1.65;
}

button {
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  padding: 6px 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--card);
  color: var(--ink);
  cursor: pointer;
  line-height: 1.5;
}

button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
button:disabled { opacity: 0.5; cursor: not-allowed; }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--ink-inverse); }
button.primary:hover:not(:disabled) { background: var(--accent-strong); color: var(--ink-inverse); }

button.link {
  border: none;
  background: none;
  padding: 0;
  color: var(--accent);
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 3px;
}

button.link.danger { color: var(--red); }

.shell { max-width: 640px; margin: 80px auto; padding: 0 20px; }
.loading, .hint { color: var(--ink-faint); }
.error {
  padding: 12px 14px;
  border: 1px solid var(--red-line);
  border-radius: var(--radius);
  background: var(--red-soft);
  color: var(--red);
}

/* ---------- Bar ---------- */

.viewer-bar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 18px;
  background: var(--card);
  border-bottom: 1px solid var(--line);
}

.viewer-bar .back {
  color: var(--accent);
  text-decoration: none;
  font-size: var(--fs-base);
  white-space: nowrap;
}

.viewer-bar .spacer { flex: 1; }

/* A bar action that navigates rather than acts on the page. */
.viewer-bar .bar-link {
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  padding: 6px 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  color: var(--ink);
  text-decoration: none;
  line-height: 1.5;
}

.viewer-bar .bar-link:hover { border-color: var(--accent); color: var(--accent); }
.zoom { display: flex; align-items: center; gap: 6px; }
.zoom-level {
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  color: var(--ink-faint);
  min-width: 42px;
  text-align: center;
}

/* ---------- Pages ---------- */

.viewer-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 0;
  height: calc(100vh - 53px);
}

.pages {
  overflow: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  background: var(--paper-sunken);
}

.pdf-page {
  position: relative;
  background: var(--card);
  box-shadow: 0 1px 6px rgba(25, 35, 50, 0.18);
  flex: none;
}

/* In placing mode the page is a target, and says so. */
.pdf-page.placing { cursor: crosshair; outline: 2px dashed var(--accent-line, #c3cedd); }
.pdf-page canvas { display: block; }
.pdf-page-blank { width: 100%; height: 100%; background: var(--card); }

.page-number {
  position: absolute;
  bottom: -18px;
  right: 0;
  font-family: var(--font-ui);
  font-size: var(--fs-2xs);
  color: var(--ink-faint);
}

.pin-layer { position: absolute; inset: 0; pointer-events: none; }

.pin {
  position: absolute;
  transform: translate(-50%, -50%);
  pointer-events: auto;
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: var(--radius-pill);
  background: var(--accent);
  border: 2px solid var(--ink-inverse);
  color: var(--ink-inverse);
  font-family: var(--font-ui);
  font-size: var(--fs-2xs);
  line-height: 1;
  box-shadow: 0 1px 4px rgba(25, 35, 50, 0.4);
}

.pin:hover:not(:disabled), .pin.active {
  background: var(--accent-strong);
  color: var(--ink-inverse);
  transform: translate(-50%, -50%) scale(1.15);
}

/* A note placed on another edition of this paper: shown where it was put,
   marked, never moved. */
.pin.drifted { background: var(--gold-ink); }

/* ---------- Rail ---------- */

.rail {
  overflow: auto;
  padding: 18px;
  background: var(--card);
  border-left: 1px solid var(--line);
}

.rail h2 {
  margin: 0 0 12px;
  font-size: var(--fs-lg);
  font-weight: 600;
}

.rail .count {
  font-family: var(--font-ui);
  font-size: var(--fs-2xs);
  color: var(--ink-faint);
  vertical-align: middle;
}

.empty { color: var(--ink-faint); font-size: var(--fs-md); }

.note-card {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 10px 12px;
  margin-bottom: 10px;
  background: var(--accent-soft);
  cursor: pointer;
}

.note-card.active { border-color: var(--accent); }
.note-card.draft { background: var(--card); border-color: var(--accent); cursor: default; }

.note-where {
  margin: 0 0 4px;
  font-family: var(--font-ui);
  font-size: var(--fs-2xs);
  color: var(--ink-faint);
  display: flex;
  align-items: center;
  gap: 6px;
}

.note-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--ink-inverse);
}

.drift {
  margin-left: auto;
  padding: 1px 7px;
  border-radius: var(--radius-pill);
  background: var(--gold-soft);
  border: 1px solid var(--gold-line);
  color: var(--gold-ink);
}

.note-text { margin: 0 0 6px; font-size: var(--fs-md); white-space: pre-wrap; }
.note-actions { display: flex; gap: 10px; align-items: center; }

.rail textarea {
  width: 100%;
  font-family: var(--font-serif);
  font-size: var(--fs-md);
  padding: 8px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  margin-bottom: 8px;
  resize: vertical;
}

@media (max-width: 860px) {
  .viewer-body { grid-template-columns: minmax(0, 1fr); height: auto; }
  .pages { padding: 12px; }
  .rail { border-left: none; border-top: 1px solid var(--line); }
}
`;
