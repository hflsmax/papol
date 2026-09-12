// Papol Desktop's styles (DESIGN.md, "Desktop shell"), appended to the sheet in
// App.jsx and so shared with boards, which import that sheet. They use the
// sheet's tokens; rules scoped to [data-shell='desktop'] apply only in the app.
export const desktopStyles = `

/* The window is the app: only the content pane scrolls, and the chrome
   never rubber-bands with it. */
[data-shell='desktop'] body {
  overflow: hidden;
  overscroll-behavior: none;
}

.desktop-app {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  height: 100vh;
}

.desktop-sidebar,
.desktop-toolbar {
  font-family: var(--font-ui);
  line-height: 1.3;
  cursor: default;
  user-select: none;
  -webkit-user-select: none;
}

.desktop-sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  padding: 0 10px 10px;
  background: var(--chrome);
  border-right: 1px solid var(--line);
  font-size: var(--fs-sm);
}

.desktop-sidebar-drag {
  flex: none;
  height: 52px;
}

.desktop-sidebar-group {
  display: grid;
  gap: 1px;
}

.desktop-sidebar-group + .desktop-sidebar-group {
  margin-top: 18px;
}

.desktop-sidebar-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-height: 22px;
  padding: 0 4px 2px 8px;
  color: var(--ink-faint);
  font-size: var(--fs-xs);
  font-weight: 600;
}

.desktop-sidebar .desktop-sidebar-label-action {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: var(--chrome-radius);
  background: transparent;
  box-shadow: none;
  color: var(--ink-faint);
  cursor: default;
  transition: none;
}

.desktop-sidebar .desktop-sidebar-label-action:hover:not(:disabled) {
  background: var(--chrome-hover);
  color: var(--ink);
}

.desktop-sidebar-label-action svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
}

/* Shelf identity, as on paper rows: a narrow vertical swatch. */
.desktop-sidebar-swatch {
  flex: none;
  width: 4px;
  height: 14px;
  margin: 0 6px;
  border-radius: 2px;
}

.desktop-sidebar-hash {
  flex: none;
  width: 16px;
  color: var(--accent);
  font-weight: 600;
  text-align: center;
}

.desktop-sidebar .desktop-sidebar-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 28px;
  padding: 4px 8px;
  border: 0;
  border-radius: var(--chrome-radius);
  background: transparent;
  box-shadow: none;
  color: var(--ink);
  font: inherit;
  text-align: left;
  text-decoration: none;
  cursor: default;
  transition: none;
  -webkit-user-drag: none;
}

.desktop-sidebar .desktop-sidebar-item:hover {
  background: var(--chrome-hover);
  color: var(--ink);
}

.desktop-sidebar .desktop-sidebar-item.active {
  background: var(--chrome-selected);
}

/* A shelf with a paper dragged over it, lit in the accent the way a native
   sidebar lights a drop target. */
.desktop-sidebar .desktop-sidebar-item.drop-target {
  background: var(--accent);
  color: var(--ink-inverse);
}

.desktop-sidebar-item.drop-target .desktop-sidebar-count {
  color: inherit;
}

.desktop-sidebar-notice {
  margin: 12px 8px 0;
  color: var(--red);
  font-size: var(--fs-xs);
}

.desktop-sidebar .desktop-sidebar-item:focus-visible,
.desktop-toolbar .desktop-toolbar-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.desktop-sidebar-item svg {
  flex: none;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: var(--accent);
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.desktop-sidebar-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.desktop-sidebar-count {
  margin-left: auto;
  color: var(--ink-faint);
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
}

.desktop-sidebar-count.unread {
  color: var(--ink-soft);
  font-weight: 600;
}

.desktop-sidebar-footer {
  display: grid;
  gap: 1px;
  margin-top: auto;
  padding-top: 10px;
}

.desktop-sidebar-account {
  display: flex;
  align-items: center;
  min-width: 0;
}

.desktop-sidebar .desktop-sidebar-profile {
  flex: 1;
  min-width: 0;
}

.desktop-sync-control {
  flex: none;
}

.desktop-sidebar .desktop-sync-button {
  min-width: 0;
  height: 28px;
  border: 0;
  border-radius: var(--chrome-radius);
  background: transparent;
  box-shadow: none;
  color: var(--ink-soft);
  font: inherit;
}

.desktop-sidebar .desktop-sync-button {
  display: grid;
  grid-template-columns: 16px auto;
  align-items: center;
  gap: 7px;
  width: auto;
  padding: 4px 8px;
  text-align: left;
}

.desktop-sidebar .desktop-sync-button:hover:not(:disabled) {
  background: var(--chrome-hover);
  color: var(--ink);
}

.desktop-sync-mark {
  display: inline-block;
  width: 16px;
  color: var(--accent);
  font-size: 18px;
  line-height: 1;
  text-align: center;
}

.desktop-sync-mark.spinning {
  animation: desktop-sync-spin .8s linear infinite;
}

@keyframes desktop-sync-spin { to { transform: rotate(360deg); } }

.desktop-sync-control.has-error .desktop-sync-mark {
  color: var(--red);
}

.desktop-sidebar-avatar {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-inline: -2px;
  border-radius: 50%;
  font-size: var(--fs-xs);
  object-fit: cover;
}

.desktop-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.desktop-toolbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 52px;
  padding: 0 20px;
  border-bottom: 1px solid var(--line);
  background: var(--paper);
}

.desktop-toolbar .desktop-toolbar-btn {
  display: grid;
  place-items: center;
  width: 30px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--chrome-radius);
  background: transparent;
  box-shadow: none;
  color: var(--ink-soft);
  cursor: default;
  transition: none;
}

.desktop-toolbar .desktop-toolbar-btn:hover:not(:disabled) {
  background: var(--chrome-hover);
  color: var(--ink);
}

.desktop-toolbar .desktop-toolbar-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.desktop-toolbar-btn svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.desktop-toolbar-title {
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  font-size: var(--fs-base);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.desktop-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.desktop-content {
  max-width: 820px;
  margin: 0 auto;
  padding: 28px 32px 48px;
}

/* Three-pane browser: the list pane beside the paper. The list header is a
   toolbar too, so these follow the toolbar rules they override. */
.desktop-browser {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
}

.desktop-list-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--line);
  background: var(--card);
  font-family: var(--font-ui);
}

.desktop-list-header {
  padding: 0 10px 0 16px;
  background: var(--card);
}

.desktop-list-heading {
  flex: 1;
  min-width: 0;
  display: grid;
  line-height: 1.25;
}

.desktop-list-heading h1 {
  overflow: hidden;
  font-size: var(--fs-base);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.desktop-list-heading span {
  color: var(--ink-faint);
  font-size: var(--fs-xs);
}

.desktop-search {
  flex: none;
  position: relative;
  display: block;
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
}

.desktop-search svg {
  position: absolute;
  top: 50%;
  left: 18px;
  width: 15px;
  height: 15px;
  transform: translateY(-50%);
  fill: none;
  stroke: var(--ink-faint);
  stroke-width: 2;
  stroke-linecap: round;
  pointer-events: none;
}

.desktop-search input {
  width: 100%;
  height: 28px;
  padding: 0 8px 0 29px;
  border: 1px solid transparent;
  border-radius: var(--chrome-radius);
  background: var(--chrome);
  color: var(--ink);
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
}

.desktop-search input:focus {
  outline: none;
  border-color: var(--accent-line);
  background: var(--card);
}

.desktop-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px;
}

.desktop-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 10px;
  border-radius: var(--chrome-radius);
  color: var(--ink);
  text-decoration: none;
  cursor: default;
  user-select: none;
  -webkit-user-select: none;
  -webkit-user-drag: none;
}

.desktop-row:hover {
  background: var(--chrome-hover);
}

.desktop-row:focus-visible {
  outline: none;
}

.desktop-row.selected {
  background: var(--chrome-selected);
}

/* A list with focus selects in the accent, as native lists do; once focus
   moves to the paper, the selection stays but turns quiet. */
.desktop-list:focus-within .desktop-row.selected {
  background: var(--accent);
  color: var(--ink-inverse);
}

.desktop-row-swatch {
  flex: none;
  align-self: stretch;
  width: 3px;
  border-radius: 2px;
}

.desktop-row-body {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
}

.desktop-row-title {
  display: -webkit-box;
  overflow: hidden;
  font-family: var(--font-serif);
  font-size: var(--fs-md);
  font-weight: 600;
  line-height: 1.3;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.desktop-row-meta,
.desktop-row-sub {
  overflow: hidden;
  font-size: var(--fs-xs);
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.desktop-row-meta {
  color: var(--ink-soft);
}

.desktop-row-sub {
  color: var(--ink-faint);
}

.desktop-row-sub:empty {
  display: none;
}

.desktop-list:focus-within .desktop-row.selected .desktop-row-meta,
.desktop-list:focus-within .desktop-row.selected .desktop-row-sub {
  color: inherit;
  opacity: 0.8;
}

.desktop-row[draggable='true'] {
  -webkit-user-drag: element;
}

.desktop-row.dragging {
  opacity: 0.5;
}

.desktop-row .state-pill {
  flex: none;
  margin-top: 2px;
}

.desktop-list-empty {
  padding: 32px 16px;
  color: var(--ink-faint);
  font-size: var(--fs-sm);
  text-align: center;
}

.desktop-detail-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.desktop-empty {
  flex: 1;
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 4px;
  padding: 32px;
  color: var(--ink-faint);
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
  text-align: center;
  cursor: default;
  user-select: none;
  -webkit-user-select: none;
}

.desktop-empty svg {
  width: 48px;
  height: 48px;
  margin-bottom: 8px;
  fill: none;
  stroke: var(--line-strong);
  stroke-width: 1.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.desktop-empty strong {
  color: var(--ink-soft);
  font-size: var(--fs-base);
  font-weight: 600;
}

.desktop-composer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.desktop-composer-head h2 {
  font-size: var(--fs-xl);
}

/* The paper beside the list is the window's own content, not a card on a
   card: the pane is white and the paper sits flush in it. */
.desktop-detail-pane,
.desktop-detail-pane .desktop-toolbar {
  background: var(--card);
}

.desktop-detail-pane .paper-detail > .panel {
  padding: 0;
  border: 0;
  background: transparent;
}

/* Inbox reads as a mail list: an unread notification is marked by a dot
   beside it, the way Mail marks one, rather than a tinted row and a badge.
   The word "new" stays for screen readers. */
[data-shell='desktop'] .notif-item,
[data-shell='desktop'] .notif-item.unread {
  position: relative;
  padding: 10px 12px 10px 28px;
  border-left: 0;
  border-radius: var(--chrome-radius);
  background: none;
}

[data-shell='desktop'] .notif-item:hover {
  background: var(--chrome-hover);
}

[data-shell='desktop'] .notif-item.unread::before {
  content: '';
  position: absolute;
  top: 18px;
  left: 11px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}

[data-shell='desktop'] .notif-new {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* Signing in is the whole window's business: the form sits in its middle,
   lifted off the ground by a shadow rather than boxed by a rule. */
[data-shell='desktop'] .auth-page {
  min-height: calc(100vh - 140px);
  align-items: center;
  padding-top: 0;
}

[data-shell='desktop'] .auth-card {
  border: 0;
  border-radius: var(--radius-lg);
  box-shadow: 0 1px 3px rgba(29, 33, 41, 0.08), 0 10px 30px rgba(29, 33, 41, 0.08);
}

[data-shell='desktop'] .auth-subtitle {
  font-style: normal;
}

/* Beside a list pane the demo notice has less room than a website header:
   it keeps to one line and lets its sentence give way to its actions. */
[data-shell='desktop'] .demo-banner {
  flex: none;
  flex-wrap: nowrap;
  justify-content: flex-start;
  padding: 6px 16px;
  font-size: var(--fs-xs);
}

[data-shell='desktop'] .demo-banner > span:first-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

[data-shell='desktop'] .demo-banner-btn {
  flex: none;
  padding: 1px 10px;
  font-size: var(--fs-xs);
}

/* The toolbar's Back and the sidebar's feedback item replace these. The
   upload review keeps its own back link: it is that form's Cancel. */
[data-shell='desktop'] .main-content {
  padding-bottom: 0;
}

[data-shell='desktop'] .back-btn:not(.upload-review-back) {
  display: none;
}

/* A board's toolbar is the window's title bar too. */
[data-shell='desktop'] .board-toolbar { min-height: 52px; padding-block: 6px; user-select: none; -webkit-user-select: none; }
[data-shell='desktop'][data-platform='mac'] .board-toolbar { padding-left: 88px; }
`;
