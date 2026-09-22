import { commonStyles } from './commonStyles.js';
import { desktopStyles } from './desktopStyles.js';
import { designTokens } from './designTokens.js';
import { itemActionsStyles } from './itemActionsStyles.js';
import { macHandoffStyles } from './macHandoffStyles.js';

// Light red makes a development desktop unmistakable. Packaged builds use
// neutral chrome so that the development cue never becomes product branding.
const desktopChrome = import.meta.env?.DEV ? '#f9ecea' : '#eaedf1';

export const applicationStyles = `
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

/* ---------- Design tokens (see frontend/DESIGN.md) ---------- */

:root {
  ${designTokens}

  /* Desktop chrome — the sidebar and toolbars of Papol macOS only */
  --chrome: ${desktopChrome};
  --chrome-hover: rgba(29, 33, 41, 0.06);
  --chrome-selected: rgba(29, 33, 41, 0.1);
  --chrome-radius: 6px;
}

${itemActionsStyles}

${commonStyles}

.app {
  max-width: 760px;
  margin: 0 auto;
  padding: 24px 20px 64px;
}

/* ---------- Nav ---------- */

.topnav {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px 20px;
  padding-bottom: 14px;
  margin-bottom: 28px;
  border-bottom: 1px solid var(--line);
}

.brand {
  font-size: var(--fs-3xl);
  font-weight: 600;
  color: var(--ink);
  text-decoration: none;
  letter-spacing: 0.02em;
}

.topnav nav {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
}

.topnav nav a,
.topnav .inbox-link {
  color: var(--ink-soft);
  text-decoration: none;
  font-size: var(--fs-base);
  padding-bottom: 2px;
  border-bottom: 2px solid transparent;
}

.topnav nav a:hover,
.topnav .inbox-link:hover {
  color: var(--accent);
  border-bottom-color: var(--line);
}

.topnav nav a.active,
.topnav .inbox-link.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

.topnav nav .macos-download-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.macos-download-link svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* ---------- Learn ---------- */

.learn-page {
  display: grid;
  gap: 34px;
}

.learn-section {
  display: grid;
  gap: 14px;
}

.learn-section > h1 {
  color: var(--ink-faint);
  font: 600 var(--fs-sm)/1 var(--font-ui);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.learn-lesson {
  border-radius: var(--radius-lg);
  box-shadow: 0 2px 8px rgba(29, 33, 41, 0.04);
  transition: border-color 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease;
}

.learn-lesson:hover {
  border-color: var(--accent-line);
  box-shadow: 0 8px 24px rgba(29, 33, 41, 0.1);
  transform: translateY(-2px);
}

.learn-lesson-open {
  display: grid;
  width: 100%;
  min-height: 238px;
  grid-template-rows: 1fr auto;
  padding: 0;
  border: 0;
  border-radius: inherit;
  background: var(--card);
  box-shadow: none;
  color: var(--ink);
  text-align: left;
}

.learn-lesson-open:hover { background: var(--card); }
.learn-lesson-open:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }

.learn-lesson-art {
  display: grid;
  min-height: 152px;
  place-items: center;
  overflow: hidden;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  background: var(--lesson-wash, var(--accent-soft));
}

.learn-lesson-art > svg { width: min(88%, 270px); height: 128px; }
.learn-lesson-footer { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 18px 20px 20px; }
.learn-art-animal { --lesson-wash: #f8eadc; --lesson-color: #a85b3f; }
.learn-art-group { --lesson-wash: #e9e5f4; --lesson-color: #66568c; }
.learn-art-send { --lesson-wash: #e1f0ec; --lesson-color: #377a6b; }
.learn-art-board-basics { --lesson-wash: #e7edf7; --lesson-color: #4b668e; }
.learn-lesson-art .art-paper { fill: #fff; stroke: var(--lesson-color, var(--accent)); stroke-width: 2; }
.learn-lesson-art .art-card { fill: #fff; stroke: var(--lesson-color, var(--accent)); stroke-width: 2.5; }
.learn-lesson-art .art-line, .learn-lesson-art .art-detail, .learn-lesson-art .art-spark, .learn-lesson-art .art-arrow { fill: none; stroke: var(--lesson-color, var(--accent)); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
.learn-lesson-art .art-image, .learn-lesson-art .art-dot { fill: var(--lesson-color, var(--accent)); }
.learn-lesson-art .art-highlight { fill: var(--lesson-color, var(--accent)); opacity: 0.18; }
.learn-lesson-art .art-animal { fill: #fff; stroke: var(--lesson-color); stroke-width: 2.5; stroke-linejoin: round; }
.learn-lesson-art .art-booklet-spine, .learn-lesson-art .art-mini-line { fill: none; stroke: var(--lesson-color); stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.learn-lesson-art .art-mini-card { fill: rgba(255, 255, 255, 0.72); stroke: var(--lesson-color); stroke-width: 1.8; }
.learn-lesson-art .art-collection-frame { fill: rgba(255, 255, 255, 0.24); stroke: var(--lesson-color); stroke-width: 2; stroke-dasharray: 5 4; }

.learn-lesson-open h2 {
  max-width: 19ch;
  font-size: var(--fs-xl);
}

.learn-play {
  width: 42px;
  height: 42px;
  flex: none;
  fill: var(--accent);
}

.learn-play circle { fill: var(--accent); }
.learn-play path { fill: var(--ink-inverse); }

.learn-player-backdrop {
  position: fixed;
  z-index: 110;
  inset: 0;
  display: grid;
  padding: 24px;
  place-items: center;
  background: rgba(17, 24, 34, 0.78);
}

.learn-player {
  position: relative;
  width: min(1040px, 100%);
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: var(--radius-lg);
  background: #000;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.42);
}

.learn-player video {
  display: block;
  width: 100%;
  max-height: calc(100vh - 48px);
  aspect-ratio: 16 / 9;
  object-fit: contain;
}

.learn-player-status {
  display: grid;
  min-height: min(72vh, 720px);
  margin: 0;
  padding: 48px;
  place-items: center;
  color: white;
  text-align: center;
}

.learn-player-close {
  position: absolute;
  z-index: 2;
  top: 10px;
  right: 10px;
  width: 38px;
  height: 38px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 50%;
  background: rgba(15, 20, 28, 0.78);
  color: white;
  font: 400 25px/1 var(--font-ui);
}

.learn-player-close:hover { background: var(--accent); }
.learn-player-close:focus-visible { outline: 2px solid white; outline-offset: 2px; }

.learn-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

@media (max-width: 600px) {
  .learn-grid {
    grid-template-columns: 1fr;
  }
  .learn-lesson-open { min-height: 220px; }
  .learn-lesson-art { min-height: 136px; }
  .learn-player-backdrop { padding: 0; }
  .learn-player { border: 0; border-radius: 0; }
}

.feedback-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.feedback-item {
  padding: 12px 0;
  border-top: 1px solid var(--line);
}

.feedback-item.resolved {
  opacity: 0.55;
}

.feedback-head {
  margin: 0 0 4px;
  font-size: var(--fs-sm);
  color: var(--ink-faint);
}

.feedback-content {
  margin: 0 0 6px;
  white-space: pre-wrap;
}

.notice-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 8px 16px;
  background: var(--gold-soft);
  color: var(--gold-ink);
  border-bottom: 1px solid var(--gold-line);
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
}

.macos-download-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 42px;
  padding: 7px 44px 7px 16px;
  position: relative;
  background: var(--accent);
  color: var(--ink-inverse);
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
}

.macos-download-banner a {
  color: inherit;
  font-weight: 600;
  text-underline-offset: 2px;
}

.macos-download-banner-dismiss {
  position: absolute;
  right: 12px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  color: inherit;
  font-size: 24px;
  font-weight: 300;
}

.macos-download-banner-dismiss:hover {
  background: color-mix(in srgb, var(--ink-inverse) 18%, transparent);
}

/* A build the service will not speak to covers its window rather than
   banding it: what is wrong is the program, and there is nothing useful
   left to do in it. */
.compatibility-stop {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: color-mix(in srgb, var(--ink) 82%, transparent);
  font-family: var(--font-ui);
}

.compatibility-stop-panel {
  max-width: 420px;
  padding: 28px 30px;
  border-radius: var(--chrome-radius, 10px);
  background: var(--paper, #fff);
  color: var(--ink);
  box-shadow: 0 18px 50px rgb(0 0 0 / 35%);
}

.compatibility-stop-panel h1 {
  margin: 0 0 12px;
  font-size: var(--fs-lg);
}

.compatibility-stop-panel p {
  margin: 0 0 12px;
  font-size: var(--fs-sm);
  line-height: 1.5;
}

.compatibility-stop-actions {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 20px;
}

.compatibility-stop-actions a,
.compatibility-stop-actions button {
  font: inherit;
  font-size: var(--fs-sm);
  font-weight: 600;
}

.compatibility-stop-actions button {
  padding: 5px 14px;
  border: 1px solid color-mix(in srgb, var(--ink) 35%, transparent);
  border-radius: var(--chrome-radius, 6px);
  background: transparent;
  color: inherit;
  box-shadow: none;
}

.compatibility-stop-actions button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--ink) 8%, transparent);
}

${macHandoffStyles}

.notice-banner-actions {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  white-space: nowrap;
}

.notice-banner-button {
  border: 1px solid var(--gold-ink);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--gold-ink);
  padding: 3px 14px;
  font-size: var(--fs-sm);
  box-shadow: none;
  text-decoration: none;
  cursor: pointer;
}

.notice-banner-button:hover {
  background: var(--gold-ink);
  color: var(--ink-inverse);
}

.notice-banner-link {
  color: var(--gold-ink);
  font-size: var(--fs-sm);
  text-decoration: underline;
}

.pdf-viewer-prompt button.notice-banner-link {
  padding: 0;
  cursor: pointer;
}

.topnav .spacer {
  flex: 1;
}

.topnav .whoami {
  color: var(--ink-faint);
  font-size: var(--fs-md);
  font-style: italic;
}

.topnav .whoami-link {
  font-style: normal;
  color: var(--accent);
  text-decoration: none;
}

.topnav .whoami-link:hover, .topnav .whoami-link.active {
  color: var(--ink);
}

.nav-avatar {
  width: 26px;
  height: 26px;
  /* inline so the profile link keeps its text baseline (aligning with the
     rest of the row) while the avatar hangs centered beside the name */
  vertical-align: middle;
  font-size: var(--fs-xs);
  margin-right: 7px;
}

/* ---------- Generic ---------- */

.panel {
  padding: 24px;
  margin-bottom: 20px;
}

/* Revealed by the button beside "Save profile", so it needs a rule of its
   own to read as a second thing in the block rather than more of the
   first. */
.password-change {
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid var(--line);
}

/* The one panel a user can do something irreversible in. It is marked
   by its edge rather than a wash of colour: the page is otherwise white
   panels, and a red one would read as an error the user must fix. */
.panel-danger {
  border-color: var(--red-line);
}

.panel-danger .panel-title {
  color: var(--red);
}

.panel-title {
  font-size: var(--fs-xl);
  margin-bottom: 14px;
}

.main-content {
  display: grid;
  /* Room for the floating feedback button, so it never sits on the last
     line of a page scrolled to its end. */
  padding-bottom: 64px;
  /* minmax(0, …) so a wide child (long nowrap text, etc.) can't blow the
     track past the viewport on narrow screens */
  grid-template-columns: minmax(0, 1fr);
  gap: 20px;
}

button.full-width {
  width: 100%;
}

.hint-anchor {
  position: relative;
  display: inline-block;
}

.compose-row .hint-anchor {
  display: flex;
  align-items: stretch;
}

.compose-row .hint-anchor button {
  align-self: stretch;
}

.hint-pop {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 40;
  width: max-content;
  max-width: 260px;
  background: var(--gold-soft);
  color: var(--gold-ink);
  border: 1px solid var(--gold-line);
  border-radius: var(--radius);
  box-shadow: 0 3px 10px rgba(29, 33, 41, 0.15);
  padding: 8px 12px;
  font-size: var(--fs-sm);
  line-height: 1.5;
}

/* Popups anchored at a row's right edge open leftward to stay in view */
.success {
  background: var(--green-soft);
  color: var(--green-ink);
  border: 1px solid var(--green-line);
  padding: 10px 14px;
  border-radius: var(--radius);
  margin-bottom: 16px;
  font-size: var(--fs-md);
}

.profile-email {
  color: var(--ink-soft);
  font-size: var(--fs-md);
  margin-bottom: 18px;
}

/* ---------- Forms ---------- */

.form-group {
  margin-bottom: 16px;
}

.form-group label,
.form-group .form-label {
  display: block;
  margin-bottom: 4px;
  font-size: var(--fs-sm);
  color: var(--ink-soft);
  font-variant: small-caps;
  letter-spacing: 0.04em;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 120px;
  gap: 16px;
}

.form-actions { margin-top: 16px; }

.pdf-row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

/* The pair reads as one choice, so both boxes are the same size: one
   width for both, and an explicit line-height so the anchor and the button
   do not render at two different heights. Secondary controls in a form,
   so they take the small-button step of the scale rather than body size. */
.pdf-row .button,
.pdf-row button {
  flex: 0 0 auto;
  width: 7.5rem;
  padding: 6px 12px;
  font-size: var(--fs-xs);
  line-height: 1.5;
  text-align: center;
}

/* A field's label and a trailing option on one line. */
.field-label-row {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  justify-content: flex-start;
  gap: 16px;
}

.field-label-row .checkbox-row.inline {
  display: inline-flex;
  align-items: center;
  flex: none;
  margin-left: 0;
}

.switch-toggle {
  padding: 2px;
  border-radius: var(--radius-pill);
  line-height: 0;
}

.switch-text {
  font-size: var(--fs-2xs);
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  line-height: 1;
  white-space: nowrap;
}

.switch-toggle.on .switch-text {
  color: var(--ink-inverse);
}

.switch-toggle.off .switch-text {
  color: var(--ink-soft);
}

.switch-toggle:hover:not(:disabled) {
  border: none;
  background: none;
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.switch {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 6px 0 4px;
  border-radius: var(--radius-pill);
  transition: background 0.15s;
}

/* Knob left + label right when hidden; label left + knob right when shown */
.switch-toggle.on .switch {
  padding: 0 4px 0 8px;
}

.switch-toggle.on .switch-knob {
  order: 2;
}

.switch-toggle.on .switch {
  background: var(--accent);
}

.switch-toggle.off .switch {
  background: var(--fill);
}

.switch-toggle.off:hover .switch {
  background: var(--fill-strong);
}

.switch-knob {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--ink-inverse);
  box-shadow: 0 1px 2px rgba(29, 33, 41, 0.3);
}

/* Text-less variant: fixed track, knob slides between the ends */
.switch-toggle .switch.bare {
  width: 40px;
  padding: 0;
  position: relative;
}

.switch-toggle .switch.bare .switch-knob {
  position: absolute;
  top: 3px;
  transition: left 0.15s;
}

.switch-toggle.on .switch.bare .switch-knob {
  left: 21px;
}

.switch-toggle.off .switch.bare .switch-knob {
  left: 3px;
}

/* ---------- Auth ---------- */

.auth-page {
  display: flex;
  justify-content: center;
  padding-top: 6vh;
}

.auth-card {
  padding: 32px 28px;
  width: 100%;
  max-width: 400px;
}

.auth-card h2 {
  margin-bottom: 6px;
}

.auth-subtitle {
  color: var(--ink-soft);
  font-size: var(--fs-md);
  font-style: italic;
  margin-bottom: 20px;
}

.auth-switch {
  margin-top: 18px;
  font-size: var(--fs-md);
  color: var(--ink-soft);
  text-align: center;
}

/* ---------- Space ---------- */

.nook-header {
  margin-bottom: 20px;
}

.nook-header h2 {
  font-size: var(--fs-2xl);
}

.nook-subtitle {
  color: var(--ink-faint);
  font-size: var(--fs-md);
  font-style: italic;
}

.nook-email {
  font-size: var(--fs-sm);
}

.nook-email a {
  color: var(--ink-faint);
}

.nook-email a:hover {
  color: var(--accent);
}

/* Checkbox and its label sit on one baseline, with the explanation
   indented under the label text. The first selector matches the
   .form-group label rule's specificity so the small-caps field-label
   styling is undone here. (No backticks in this sheet — it lives in a
   JS template literal.) */
.form-group label.checkbox-row,
.checkbox-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px;
  align-items: start;
  font-variant: normal;
  letter-spacing: normal;
  color: var(--ink);
  cursor: pointer;
}

.checkbox-row input[type='checkbox'] {
  width: 15px;
  height: 15px;
  margin-top: 3px;
  accent-color: var(--accent);
}

/* ---------- Upload ---------- */

.upload-review-mode > .back-button:not(.upload-review-back),
.upload-review-mode > .shelf-manager,
.upload-review-mode > .paper-list {
  display: none;
}

.upload-review-mode .nook-header-row { display: block; }
.upload-review-mode .nook-header-row > .nook-avatar,
.upload-review-mode .nook-header-row > .nook-profile-copy,
.upload-review-mode .nook-header-actions > .new-board-button { display: none; }
.upload-review-mode .nook-header-actions { display: block; width: 100%; margin: 0; }

.upload-review-mode .paper-form {
  padding: 18px;
}

.paper-metadata-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.paper-metadata-heading h3 { margin: 0; }

/* One line under the heading while the PDF is read (the wait itself), and
   the same line when it could not be: the form is open either way, and
   nothing about the reading is worth a banner. */
.metadata-reading {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 8px 0 0;
  color: var(--ink-faint);
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
}

/* The version Papol already holds of the work, and the choice between it
   and this PDF, on the same line as the reading's. */
.metadata-reading.known-version { flex-wrap: wrap; }
.metadata-reading.known-version input[type='radio'] { margin: 0; accent-color: var(--accent); }

.upload-review-form .form-group {
  margin-bottom: 12px;
}

.upload-review-form .form-group > label,
.upload-review-form .field-label-row {
  margin-bottom: 3px;
}

.upload-review-form .form-group input,
.upload-review-form .form-group textarea,
.upload-review-form .form-group select {
  padding: 7px 9px;
}

.upload-review-form .form-group select { width: 100%; }

.upload-review-form .tag-editor-card,
.upload-review-form .upload-private-card,
.upload-review-form .upload-public-card {
  padding: 6px;
}

.upload-review-form .tag-editor {
  min-height: 32px;
}

.upload-review-form .form-actions {
  margin-top: 12px;
}

.dropzone {
  border: 1px dashed var(--ink-faint);
  border-radius: var(--radius);
  padding: 32px 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.15s;
  background: var(--card);
  margin-bottom: 20px;
}

.dropzone:hover, .dropzone.dragging {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.dropzone p {
  color: var(--ink-soft);
}

/* The upload's wait, where the drop went (docs/waiting.md). */
.dropzone .wait-progress {
  max-width: 360px;
  margin: 0 auto;
  text-align: left;
}

.dropzone .hint {
  font-size: var(--fs-sm);
  color: var(--ink-faint);
  margin-top: 6px;
  font-style: italic;
}

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

/* A sync that did not finish, said where the user is (SyncAttention). */
.sync-attention {
  position: fixed;
  z-index: 1000;
  left: 16px;
  bottom: 16px;
  display: grid;
  gap: 6px;
  width: min(340px, calc(100vw - 32px));
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-left: 3px solid var(--red);
  border-radius: var(--radius);
  background: var(--card);
  box-shadow: 0 8px 24px rgba(29,33,41,.18);
  font: var(--fs-sm) var(--font-ui);
}
.sync-attention p { margin: 0; color: var(--ink-soft); line-height: 1.4; }
.sync-attention-actions { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.sync-attention-close { margin-left: auto; border: 0; background: none; color: var(--ink-soft); font-size: var(--fs-lg); line-height: 1; cursor: pointer; }

.upload-section.compact { flex: 1 1 240px; min-width: 180px; }
.upload-section.compact .dropzone { display: grid; place-items: center; min-height: 48px; margin: 0; padding: 8px 12px; }
.upload-section.compact .dropzone p { margin: 0; font-family: var(--font-ui); font-size: var(--fs-xs); line-height: 1.35; }
.upload-section.compact .error { position: absolute; z-index: 10; width: min(360px, 100%); margin-top: 6px; }

/* ---------- Paper list ---------- */
.tag-editor { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
.tag-chip { padding: 4px 10px;}
.tag-chip.selected { background: var(--accent); border-color: var(--accent); color: var(--ink-inverse); }
.paper-browser { margin: -24px -24px 0; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--paper-sunken) 55%, var(--card)); font-family: var(--font-ui); }
.paper-browser-toggle { display: grid; grid-template-columns: max-content minmax(0, 1fr) 16px; align-items: center; gap: 10px; width: 100%; padding: 9px 24px;border-radius: 0;color: var(--ink-soft); text-align: left; }
.paper-browser-toggle:hover, .paper-browser-toggle:focus-visible { background: color-mix(in srgb, var(--accent-soft) 45%, transparent); color: var(--ink); }
.paper-browser-title { display: inline-flex; align-items: center; gap: 7px; color: var(--ink); font-size: var(--fs-sm); font-weight: 650; white-space: nowrap; }
.paper-browser-dot { width: 7px; height: 7px; border-radius: 50%; }
.paper-browser-summary { overflow: hidden; color: var(--ink-faint); font-size: var(--fs-xs); text-overflow: ellipsis; white-space: nowrap; }
.paper-browser-toggle svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.7; transition: transform .15s ease; }
.paper-browser.open .paper-browser-toggle svg { transform: rotate(180deg); }
.paper-search-tools { align-items: stretch; flex-direction: column; gap: 8px; margin: 0; padding: 4px 24px 14px; font-family: var(--font-ui); }
.paper-list { transition: border-color .15s ease, background .15s ease; }
.paper-list.shelf-view { border-color: color-mix(in srgb, var(--active-shelf-color) 38%, var(--line)); background: color-mix(in srgb, var(--active-shelf-color) 7%, var(--card)); }
.shelf-filter { width: auto; margin: 0; padding: 4px 0 8px; }
.shelf-filter-case { display: flex; align-items: flex-end; gap: 5px; padding: 0; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.shelf-filter-case::-webkit-scrollbar { display: none; }
.shelf-filter-cubby { --cubby-color: var(--shelf-color, var(--ink-soft)); position: relative; display: inline-flex; flex: 0 0 auto; align-items: center; gap: 9px; min-width: 132px; margin-bottom: -1px; padding: 6px 10px 7px 8px; border: 1px solid var(--line); border-bottom-color: var(--line); border-radius: var(--radius) var(--radius) 0 0; background: color-mix(in srgb, var(--card) 82%, var(--paper-sunken)); box-shadow: 0 -1px 2px rgba(34, 43, 54, .04); color: var(--ink-soft); font-size: var(--fs-xs); text-align: left; transition: background .12s ease, border-color .12s ease, color .12s ease, transform .12s ease; }
.shelf-filter-cubby::before { content: ''; position: absolute; top: -1px; right: -1px; left: -1px; height: 2px; border-radius: var(--radius) var(--radius) 0 0; background: color-mix(in srgb, var(--cubby-color) 55%, var(--line)); }
.shelf-filter-cubby:hover, .shelf-filter-cubby:focus-visible { border-color: color-mix(in srgb, var(--cubby-color) 28%, var(--line)); background: var(--card); color: var(--ink); }
.shelf-filter-cubby.selected { padding-top: 7px; border-color: color-mix(in srgb, var(--cubby-color) 48%, var(--line)); border-bottom-color: var(--card); background: var(--card); box-shadow: 0 -2px 5px rgba(34, 43, 54, .07); color: var(--ink); }
.shelf-filter-cubby.selected::before { height: 3px; background: var(--cubby-color); }
.shelf-filter-spine { position: relative; width: 15px; height: 25px; flex: none; border-radius: 2px 1px 1px 2px; background: var(--cubby-color); box-shadow: inset 2px 0 rgba(255,255,255,.22), inset -1px 0 rgba(29,33,41,.12); }
.shelf-filter-spine > span { position: absolute; right: 2px; left: 3px; height: 1px; background: rgba(255,255,255,.58); }
.shelf-filter-spine > span:nth-child(1) { top: 5px; }
.shelf-filter-spine > span:nth-child(2) { top: 8px; }
.shelf-filter-spine > span:nth-child(3) { bottom: 4px; }
.shelf-filter-copy { display: grid; min-width: 0; gap: 1px; }
.shelf-filter-name { max-width: 128px; overflow: hidden; color: var(--ink); font-weight: 650; letter-spacing: .01em; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
.shelf-filter-meta { display: flex; align-items: center; gap: 4px; color: var(--ink-faint); font-size: 9px; font-variant-numeric: tabular-nums; line-height: 1.25; white-space: nowrap; }
.shelf-filter-visibility { display: inline-flex; align-items: center; gap: 2px; }
.shelf-filter-visibility svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.25; stroke-linecap: round; stroke-linejoin: round; }
.shelf-filter-cubby.selected .shelf-filter-meta { color: color-mix(in srgb, var(--cubby-color) 60%, var(--ink-soft)); }
.shelf-filter-x { position: relative; display: block; width: 17px; height: 17px; flex: none; margin-left: 2px; border-radius: 50%; background: color-mix(in srgb, var(--cubby-color) 12%, var(--paper-sunken)); color: var(--ink-faint); }
.shelf-filter-x::before, .shelf-filter-x::after { content: ''; position: absolute; top: 50%; left: 50%; width: 7px; height: 1px; border-radius: 1px; background: currentColor; transform-origin: center; }
.shelf-filter-x::before { transform: translate(-50%, -50%) rotate(45deg); }
.shelf-filter-x::after { transform: translate(-50%, -50%) rotate(-45deg); }
.shelf-filter-cubby:hover .shelf-filter-x, .shelf-filter-cubby:focus-visible .shelf-filter-x { background: color-mix(in srgb, var(--cubby-color) 20%, var(--paper)); color: var(--ink); }
.search-tag-filters { display: flex; justify-content: flex-start; align-items: center; gap: 6px; flex-wrap: wrap; width: 100%; }
.search-tag-filters .tag-chip { padding: 3px 9px; font-size: var(--fs-xs); }
.library-search-tools { align-items: stretch; flex-direction: column; gap: 8px; }
.library-user-filters { display: flex; justify-content: flex-start; align-self: flex-start; width: 100%; gap: 6px; overflow-x: auto; padding-bottom: 10px; text-align: left; }
.library-user-filters { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--line-strong) 45%, transparent) transparent; }
.library-user-filters::-webkit-scrollbar { height: 1px; }
.library-user-filters::-webkit-scrollbar-track { background: transparent; }
.library-user-filters::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--line-strong) 45%, transparent); border-radius: var(--radius-pill); }
.user-filter { justify-content: flex-start; flex: none; gap: 5px; padding: 3px 8px;font-family: var(--font-ui); font-size: var(--fs-xs); text-align: left; white-space: nowrap; }
.user-filter.selected { background: var(--accent); border-color: var(--accent); color: var(--ink-inverse); }
.user-filter-avatar { width: 20px; height: 20px; }
.avatar-initial.user-filter-avatar { font-size: var(--fs-2xs); line-height: 1; }
.library-search-line { display: flex; align-items: center; gap: 12px; width: 100%; }
.library-search-line > input { flex: 1 1 auto; min-width: 0; }
.library-search-line .sort-control { flex: none; }
.paper-tags { margin: 0 0 14px; }
.tag-editor-card,
.upload-private-card { padding: 8px 12px; background: var(--accent-soft); border-radius: var(--radius); }
.upload-private-field > label { color: var(--accent); }
.upload-shelf-select { position: relative; padding: 6px; border-radius: var(--radius); background: var(--accent-soft); }
.upload-shelf-select svg { right: 16px; }
.upload-private-summary textarea { display: block; background: var(--card); border-color: var(--accent-line); }
.upload-private-summary textarea:focus { border-color: var(--accent); }
.upload-public-field > label { color: var(--green-ink); }
.upload-public-card { padding: 8px 12px; background: var(--green-soft); border-radius: var(--radius); }
.upload-public-thought input { background: var(--card); border-color: var(--green-line); }
.upload-public-thought input:focus { border-color: var(--green); }
.tag-picker { position: relative; font-family: var(--font-ui); }
.tag-editor { min-height: 34px; padding: 2px 6px; gap: 5px; background: var(--card); border: 1px solid var(--accent-line); border-radius: var(--radius); }
.tag-editor:focus-within { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.tag-editor .tag-chip { border: 1px solid var(--accent-line); background: var(--card); color: var(--accent-strong); padding: 2px 7px; font-family: var(--font-ui); font-size: var(--fs-sm);}
.tag-editor .tag-chip:hover { border-color: var(--red); color: var(--red); }
.tag-editor .tag-input { flex: 1 1 10rem; width: auto; min-width: 8rem; padding: 3px 2px;font-size: var(--fs-sm); }
.tag-editor .tag-input:focus { outline: 0; box-shadow: none; }
.tag-dropdown { position: absolute; z-index: 20; top: calc(100% + 3px); left: 0; right: 0; overflow: hidden; padding: 3px; border-color: var(--accent-line); font-family: var(--font-ui); }
.tag-dropdown-label { padding: 4px 8px 2px; color: var(--ink-faint); font-size: var(--fs-2xs); font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
.tag-dropdown button { display: flex; width: 100%; gap: 7px; align-items: center;border-radius: var(--radius);text-align: left; padding: 6px 8px; font-size: var(--fs-sm); }
.tag-dropdown button:hover, .tag-dropdown button:focus { background: var(--paper-sunken); }
.tag-option-mark { color: var(--ink-faint); font-weight: 600; }
.tag-option-hint { margin-left: auto; color: var(--ink-faint); font-size: var(--fs-xs); opacity: 0; }
.tag-dropdown button:hover .tag-option-hint, .tag-dropdown button:focus .tag-option-hint { opacity: 1; }
.tag-create-option { margin-top: 4px; border-top: 1px solid var(--line) !important; border-radius: 0 0 3px 3px !important; color: var(--accent-strong); }
.tag-create-mark { display: grid; place-items: center; width: 19px; height: 19px; border: 1px solid currentColor; border-radius: 50%; font-weight: 600; line-height: 1; }
.tag-empty { display: block; padding: 10px; color: var(--ink-faint); }

.nook-title-row { display: flex; align-items: center; gap: 7px; }
.manage-nook-gear { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border-color: transparent; border-radius: 50%; background: transparent; box-shadow: none; color: var(--ink-faint); }
.manage-nook-gear:hover, .manage-nook-gear:focus-visible { border-color: var(--line); background: var(--paper-sunken); color: var(--accent); }
.gear-symbol { display: block; font-family: var(--font-ui); font-size: 18px; font-weight: 400; line-height: 1; }
.shelf-manager-overlay { padding: 20px; }
.shelf-manager.modal-box { width: min(530px, 100%); max-height: min(80vh, 520px); overflow: auto; padding: 14px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--card); font-family: var(--font-ui); }
.shelf-manager-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
.shelf-manager-head h3 { font-size: var(--fs-lg); }
.shelf-manager-head p { margin-top: 2px; color: var(--ink-faint); font-size: var(--fs-xs); }
.nook-manager-error { margin-bottom: 8px; padding: 6px 8px; border: 1px solid var(--red); border-radius: var(--radius); background: var(--red-soft); color: var(--red); font-size: var(--fs-xs); }
.shelf-paper-count { color: var(--ink-faint); font-size: var(--fs-xs); }
.shelf-manager-close { flex: 0 0 auto; }
.shelf-manager .icon-button svg { display: block; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.shelf-manager-list { display: grid; gap: 5px; }
.shelf-manager-row { position: relative; display: grid; grid-template-columns: 26px minmax(8rem, 1fr) minmax(7rem, auto) minmax(5.5rem, auto); align-items: center; gap: 7px; padding: 6px 34px 6px 6px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--paper); }
.shelf-color-control { display: grid; place-items: center; }
.shelf-color-input { width: 22px; height: 22px; padding: 1px; border: 1px solid var(--line-strong); border-radius: 50%; background: var(--card); cursor: pointer; }
.shelf-name-block { display: grid; min-width: 0; }
.shelf-name-input { width: 100%; min-width: 0; padding: 2px 2px 3px;border-bottom: 1px solid transparent; border-radius: 0;color: var(--ink); font-size: var(--fs-base); font-weight: 600;}
.shelf-name-input:hover { border-bottom-color: var(--line-strong); }
.shelf-name-input:focus { outline: 0; border-bottom-color: var(--accent); box-shadow: none; }
.shelf-visibility-toggle { justify-self: start; }
.shelf-default { display: inline-flex; justify-self: end; align-items: center; gap: 5px; color: var(--ink-soft); font-size: var(--fs-xs); white-space: nowrap; cursor: pointer; }
.shelf-default input { width: 14px; height: 14px; margin: 0; accent-color: var(--accent); }
.shelf-delete-button { position: absolute; top: 50%; right: 5px; transform: translateY(-50%); color: var(--ink); }
.shelf-add { margin-top: 9px; font-size: var(--fs-xs); }
.nook-manager-section { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
.nook-manager-section-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 7px; }
.nook-manager-section-head h4 { font-size: var(--fs-base); }
.nook-manager-section-head p { color: var(--ink-faint); font-size: var(--fs-xs); }
.manage-tag-list { display: flex; flex-wrap: wrap; gap: 5px; }
.manage-tag-row { display: inline-flex; align-items: center; gap: 1px; padding-right: 2px; border: 1px solid var(--line); border-radius: var(--radius-pill); background: var(--paper); }
.manage-tag-row .tag-chip {color: var(--ink-soft); font-size: var(--fs-xs); }
.manage-tag-row .icon-button { width: 24px; height: 24px; }
.manage-tag-row .tag-delete-button { color: var(--ink); }
.manage-tag-add { display: flex; gap: 6px; margin-top: 8px; }
.manage-tag-add input { flex: 1; min-width: 0; padding: 5px 8px; border: 1px solid var(--accent-line); border-radius: var(--radius); background: var(--card); font-family: var(--font-ui); font-size: var(--fs-sm); }
.manage-tag-add input:focus { outline: 0; border-color: var(--accent); }
.manage-tag-add button { padding: 5px 9px; font-size: var(--fs-xs); box-shadow: none; }
.shelf-bar { display: flex; align-items: stretch; padding: 7px 5px; }
.shelf-current { width: 8px; padding: 0; border: 0; border-radius: var(--radius-pill); background: var(--shelf-color); box-shadow: none; opacity: .82; transition: width .12s ease, opacity .12s ease; }
.shelf-current:hover, .shelf-current:focus-visible { width: 10px; opacity: 1; }
.shelf-palette { position: absolute; z-index: 15; top: 5px; right: 15px; min-width: 145px; padding: 4px; font-family: var(--font-ui); }
.shelf-palette button { display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 7px;color: var(--ink-soft); font-size: var(--fs-xs); text-align: left; }
.shelf-palette button:hover, .shelf-palette button:focus-visible { background: var(--paper); }
.shelf-palette button.active { color: var(--ink); font-weight: 600; }
.shelf-palette button > span { width: 6px; height: 18px; border-radius: var(--radius-pill); }
.paper-shelf-picker { display: inline-flex; align-items: center; gap: 6px; }
.paper-shelf-picker label { color: var(--ink-soft); font-family: var(--font-ui); font-size: var(--fs-xs); }
.paper-shelf-picker select { max-width: 12rem; padding: 5px 30px 5px 7px; border: 1px solid var(--line-strong); border-radius: var(--radius); background-color: var(--card); color: var(--ink-soft); font-family: var(--font-ui); font-size: var(--fs-xs); }

.search-bar {
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.search-bar input {
  flex: 1;
}

.sort-control {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
  color: var(--ink-soft);
  white-space: nowrap;
}

.sort-control select {
  padding: 7px 30px 7px 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background-color: var(--card);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cpath d='m4 6 4 4 4-4' fill='none' stroke='%234d5561' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-position: right 8px center;
  background-repeat: no-repeat;
  font: inherit;
  color: inherit;
}

.search-bar input {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  font-size: var(--fs-base);
  font-family: inherit;
  background: var(--card);
}

.search-bar input:focus {
  outline: none;
  border-color: var(--accent);
}

.paper-list ul {
  list-style: none;
}

.paper-list li {
  /* room on the left for the display bar's lane */
  padding: 10px 8px 10px 26px;
  border-bottom: 1px solid var(--line);
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
}

.paper-item {
  flex: 1;
  min-width: 0;
}

/* Whether a paper is on display, drawn as the row's own left edge.
   That edge already carried this: a hidden row went dashed there. Making
   it the control means one thing says the state and changes it, rather
   than a badge in one corner repeating a border in the other.

   Solid --green is Papol's "public"; dashed --line-strong is a paper
   withheld. Both are the tokens' own values — the bar is a saturated annotation
   on the page, which is exactly the role the base of a family plays.
   4px of paint in a 14px target that runs the row's full height: thin to
   look at, but tall and against the edge, which is the easiest kind of
   thing to hit. */
.bar-anchor {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 18px;
  display: flex;
}

/* The warning pops from the edge the bar is on. */
.bar-anchor .hint-pop {
  left: 0;
  right: auto;
}

.paper-list li:last-child {
  border-bottom: none;
}

.paper-item h4 {
  font-weight: 600;
}
.paper-list li.nook-board-row { min-height: 66px; isolation: isolate; }
.paper-list li.nook-board-row::before { content: ''; position: absolute; z-index: -1; inset: 0 0 0 18px; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Ccircle cx='2' cy='2' r='1.05' fill='%237e8794' fill-opacity='.42'/%3E%3C/svg%3E"); background-repeat: repeat; pointer-events: none; }
.board-item-row { display: flex; align-items: center; }
.nook-board-title { font: inherit; letter-spacing: inherit; line-height: inherit; }
.nook-inline-board-create { margin-bottom: 18px; font-family: var(--font-ui); }
.board-create-heading { margin-bottom: 16px; }
.board-create-heading h3 { font-size: var(--fs-xl); }
.board-create-heading p { margin-top: 2px; color: var(--ink-faint); font-size: var(--fs-sm); }
.board-create-fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(210px, .65fr); gap: 14px; }
.board-create-fields .form-group { margin-bottom: 0; }
/* One shelf picker, wherever a shelf is being chosen: the accent ring and
   its own drawn chevron over the shared select. */
.shelf-select { position: relative; }
.shelf-select select { width: 100%; min-width: 0; border-color: var(--accent-line); background-image: none; }
.shelf-select select:focus { border-color: var(--accent); }
.shelf-select svg { position: absolute; top: 50%; right: 11px; width: 16px; height: 16px; transform: translateY(-50%); fill: none; stroke: var(--accent); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.board-create-shelf-hint { margin-top: 4px; color: var(--ink-faint); font-size: var(--fs-xs); }

.paper-title-link {
  color: inherit;
  text-decoration: none;
}

.paper-title-link:hover {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.paper-meta {
  font-size: var(--fs-sm);
  color: var(--ink-soft);
  font-style: italic;
}

/* ---------- Grouped papers (Papers tab) ---------- */

.grouped-papers {
  list-style: none;
}

.paper-group {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 16px;
  padding: 16px 8px;
  border-bottom: 1px solid var(--line);
}

.paper-group-head {
  flex: 1;
  min-width: 240px;
}

.library-board-link {
  color: inherit;
  text-decoration: none;
}

.library-board-link:hover h4 {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.paper-group:last-child {
  border-bottom: none;
}

.paper-group-head h4 {
  font-weight: 600;
}

.entry-avatar {
  width: 24px;
  height: 24px;
  font-size: var(--fs-xs);
}

/* ---------- Avatars ---------- */

.avatar-img {
  object-fit: cover;
  background: var(--accent-soft);
}

.nook-header-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

.nook-profile-copy { min-width: 0; }
.nook-header-actions { display: flex; flex: 1 1 320px; align-items: flex-start; gap: 8px; min-width: 0; margin-left: auto; }
.new-board-button { display: inline-grid; grid-template-columns: 22px auto; align-items: center; gap: 10px; min-height: 48px; padding: 7px 16px 7px 9px; font-family: var(--font-ui); font-size: var(--fs-md); font-weight: 400; text-align: left; white-space: nowrap; }
.new-board-mark { display: grid; grid-template-columns: repeat(2, 3px); place-content: center; gap: 3px; width: 22px; height: 22px; border: 1px solid var(--accent-line); border-radius: var(--radius); background: var(--paper); }
.new-board-mark i { width: 3px; height: 3px; border-radius: 50%; background: currentColor; }

.nook-avatar {
  width: 48px;
  height: 48px;
  font-size: var(--fs-xl);
}

.avatar-row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}

.profile-avatar {
  width: 64px;
  height: 64px;
  font-size: var(--fs-3xl);
}

.avatar-buttons {
  display: flex;
  align-items: center;
  gap: 12px;
}

.avatar-hint {
  font-size: var(--fs-xs);
  font-style: italic;
  margin-top: 4px;
}

.summary-edit {
  margin-left: 10px;
  font-size: var(--fs-xs);
}

.no-papers {
  text-align: center;
  color: var(--ink-faint);
  padding: 20px;
  font-style: italic;
}

.no-papers .link-button {
  margin-top: var(--space-2);
  font-style: normal;
}

/* ---------- Ratings ---------- */

.rating-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 22px;
  margin: 10px 0;
}

.rating-summary.compact {
  gap: 4px 16px;
  margin: 6px 0 0;
}

.rating-item {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
}

.rating-label {
  font-size: var(--fs-xs);
  color: var(--ink-soft);
  font-variant: small-caps;
  letter-spacing: 0.04em;
}

.rating-dots {
  letter-spacing: 2px;
  font-size: var(--fs-2xs);
  color: var(--accent);
}

.rating-dots .dot:not(.filled) {
  color: var(--ink-faint);
}

.rating-number { display: none; color: var(--accent); font: 600 var(--fs-xs) var(--font-ui); }

.rating-none {
  color: var(--ink-faint);
  font-style: italic;
  font-size: var(--fs-sm);
}

.rating-tail {
  display: inline-flex;
  align-items: center;
  min-width: 70px;
  margin-left: 6px;
}

.rating-clear {
  padding: 0 2px;
  font-size: var(--fs-lg);
  line-height: 1;
  color: var(--ink-faint);
}

.rating-clear:hover {
  border: none;
  background: none;
  color: var(--accent);
}

.rating-inputs {
  display: grid;
  gap: 8px;
}

.rating-input-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.rating-input-row .rating-question {
  font-size: var(--fs-md);
  color: var(--ink-soft);
  margin: 0;
}

.rating-buttons {
  display: flex;
  gap: 4px;
}

.rating-button {
  width: 34px;
  height: 34px;
  padding: 0;
  border-radius: 50%;
  font-size: var(--fs-sm);
}

.rating-button.selected {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--ink-inverse);
}

.rating-button.none {
  border-style: dashed;
  color: var(--ink-faint);
}

.rating-button.none.selected {
  background: var(--ink-soft);
  border-color: var(--ink-soft);
  border-style: solid;
  color: var(--ink-inverse);
}

.visibility-badge {
  border-color: currentColor;
  margin-left: 8px;
  font-style: normal;
}

.visibility-badge.public {
  color: var(--green-ink);
  border-color: var(--green-line);
  background: var(--green-soft);
}

.visibility-badge.private {
  color: var(--accent);
  border-color: var(--accent-line);
  background: var(--accent-soft);
}

/* Neither public nor private: handed to particular people, by a link the
   user can take back. Gold, which is the colour Papol already uses for
   a user's own annotations. */
.visibility-badge.shared {
  color: var(--gold-ink);
  border-color: var(--gold-line);
  background: var(--gold-soft);
}

/* A live link is a state of the paper, so it sits on the page rather than
   inside the share menu, and stays visible for as long as it is true. */
.shared-reading-bar {
  margin: 14px 0 4px;
  padding: 12px 14px;
  border: 1px solid var(--gold-line);
  border-radius: var(--radius);
  background: var(--gold-soft);
}

.shared-reading-head {
  display: flex;
  align-items: baseline;
  gap: 4px;
  flex-wrap: wrap;
}

.shared-reading-head .visibility-badge {
  margin-left: 0;
}

.shared-reading-head p {
  flex: 1 1 260px;
  margin: 0;
  color: var(--ink-soft);
  font-size: var(--fs-xs);
  line-height: 1.45;
}

.shared-reading-bar .share-link-row {
  margin-top: 10px;
}

.shared-reading-bar .share-link-row input {
  background: var(--card);
}

.shared-reading-bar .share-revoke {
  flex: none;
  color: var(--red);
}

/* The question a link carrying annotations asks before it is closed. Inside the
   bar rather than over the page: it is a choice between two ordinary
   actions, not a warning about a dangerous one. */
.shared-reading-ask {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--gold-line);
}

.shared-reading-ask p {
  margin: 0 0 9px;
  color: var(--ink);
  font-size: var(--fs-xs);
  line-height: 1.45;
}

.shared-reading-ask-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.shared-reading-ask-actions button {
  flex: none;
  padding: 5px 11px;
}

/* The quiet way out of the question, in the ink the question itself uses. */
.shared-reading-ask-actions .link-button {
  color: var(--ink-soft);
}

/* The one thing to decide when making a link, so it sits between the
   description and the button rather than beside them. */
.share-annotations-choice {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 3px 9px;
  color: var(--ink);
  font-size: var(--fs-xs);
  line-height: 1.35;
  cursor: pointer;
}

.share-annotations-choice input {
  flex: none;
  margin: 0;
}

.share-menu-heading {
  display: block;
  margin: 2px 3px 0;
  color: var(--ink-soft);
  font-size: var(--fs-xs);
  font-weight: 700;
}

.inline-ratings {
  margin: 10px 0;
}

/* On the paper page the three rating controls sit side by side on one
   row to keep the first panel short. Each cell stacks its label over
   the buttons so nothing wraps mid-row. The green tint annotations the
   ratings as public — see .summary-text / .comment for the private
   blue counterpart. */
.inline-ratings .rating-inputs {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px 18px;
  padding: 8px 12px;
  background: var(--green-soft);
  border-radius: var(--radius);
}

.inline-ratings .rating-input-row {
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
}

.inline-ratings .rating-button {
  width: 25px;
  height: 25px;
  font-size: var(--fs-xs);
}

.inline-ratings .rating-tail {
  min-width: 0;
}

@media (max-width: 760px) {
  .inline-ratings .rating-inputs {
    grid-template-columns: 1fr;
  }
}

/* ---------- Paper detail ---------- */

.back-button {
  margin-bottom: 18px;
  color: var(--accent);
  padding: 0;
  font-size: var(--fs-md);
  text-decoration: none;
  cursor: pointer;
}
.back-button.disabled { pointer-events: none; opacity: .55; }

/* A jacket's way back sits midway between the page header and the panel,
   16px from each: drawn up into the header's 28px bottom margin (.topnav,
   which every page shares) and leaving as much below it. A block, so the
   margins hold; only as wide as its words, so the rest of the row is not
   a link. Both jackets are laid out the same way, plain blocks spaced by
   their own margins (.panel's 20px between panels), so one rule places it
   in each. */
.paper-jacket > .back-button,
.board-jacket > .back-button {
  display: block;
  width: fit-content;
  margin: -12px 0 16px;
}

.back-button:hover {
  text-decoration: underline;
  background: none;
  border: none;
}

.paper-info {
  position: relative;
}

.paper-info h2 {
  font-size: var(--fs-2xl);
  margin-bottom: 0;
}

/* The paper page's title and its controls share a row and centre on each
   other, so the controls sit level with the title whether it runs to one
   line or four. Never wraps: the controls belong in the top-right corner.
   (Distinct from .paper-title-row, the list-row title, which does wrap.) */
/* Spacing belongs to the row, not to the title inside it: the row also
   carries the display toggle and the delete button, and a margin on the
   h2 alone spaces the heading while leaving its neighbours behind. */
.detail-title-row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: nowrap;
  margin-bottom: 6px;
}

.detail-title-row h2 {
  flex: 1 1 auto;
  min-width: 0;
}

.detail-authors-row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: nowrap;
  margin-bottom: 8px;
}

.detail-authors-row .authors {
  flex: 1 1 auto;
  min-width: 0;
}

.detail-authors-row .checkbox-row {
  flex: none;
}

.detail-toggle {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
}

/* Icon button: chrome-free, the glyph inherits currentColor so a state or
   danger modifier recolours it. Always carries a title and an aria-label —
   an icon has no name of its own. */
.icon-button {
  padding: 4px;
  line-height: 0;
  color: var(--ink-faint);
  border-radius: var(--radius);
}

.icon-button:hover:not(:disabled) {
  border: none;
  background: var(--paper);
  color: var(--ink);
}

/* A destructive icon states itself in red at rest, not only on hover. */
.icon-button.danger-icon {
  color: var(--red);
}

.icon-button.danger-icon:hover:not(:disabled) {
  background: var(--red-soft);
  color: var(--red);
}

.paper-info .authors {
  color: var(--ink-soft);
  margin-bottom: 0;
  font-style: italic;
}

.metadata {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 0;
}

.metadata span, .metadata a {
  font-size: var(--fs-md);
  color: var(--ink-soft);
}

.metadata .doi {
  color: var(--accent);
  text-decoration: none;
}

.metadata .doi:hover {
  text-decoration: underline;
}

.nook-chip {
  gap: 10px;
  padding: 5px 16px 5px 6px;
  margin: 6px 0 10px;
  transition: all 0.15s;
}

.nook-chip:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.nook-chip-avatar {
  width: 30px;
  height: 30px;
  font-size: var(--fs-md);
}

.entry-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 0;
  flex-shrink: 0;
  margin-left: auto;
}

.entry-chips .chip-pop,
.title-chips .chip-pop {
  left: auto;
  right: 0;
}

/* Title, state pill and user chips read as one line about one paper.
   The row used to wrap, and because a flex line is broken on an item's
   *unwrapped* width, a title long enough to wrap sent the chips to a line
   of their own — the narrow-screen arrangement, arriving on a wide screen
   by accident. So the row is one line and the title shrinks to make room,
   wrapping inside itself instead.

   The pill and the chips are then centred against the title however many
   lines it turns out to need, rather than pinned to its first: they belong
   to the whole title, and a two-line title with them hanging off the top
   reads as though they belong only to the words above them. The chips get
   a line of their own again below 560px, where there genuinely is no room
   — see the media query at the end of this sheet. */
.paper-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.paper-title-row h4 {
  /* Shrink but never grow. The pill is about this paper's seminar and
     reads as part of the title, so it stays against it; the free space
     goes to the chips' auto margin below instead of to the heading. A
     long title still gives way rather than pushing anything off the
     line. */
  flex: 0 1 auto;
  min-width: 0;
  line-height: 1.3;
}

/* The state pill and the user chips are the same kind of thing here:
   something sitting beside the title, on the title's first line. Giving
   them the same box is what makes them agree with each other and with the
   line — the pill used to be inside the heading, riding the text baseline,
   which left it low against a serif line. */
.title-state {
  display: flex;
  align-items: center;
  flex: none;
}

.title-chips {
  display: flex;
  gap: 4px;
  align-items: center;
  margin-left: auto;
}

/* Except in a nooks row, where the chips belong to the words beside them
   rather than to the width of the row. "In 2 nooks:" and the faces are one
   phrase, and the auto margin that sends chips to the end of a title row
   put the rest of the line through the middle of it. */
.nooks-row .title-chips {
  margin-left: 0;
}

/* A nook row's users. They answer to the whole row rather than to the
   title, so they sit at the row's right edge and centre against all of it,
   and they are drawn large: who else has this paper is the reason to look
   down someone's nook, and it should be legible at a glance rather than
   read one 22px circle at a time. */
.row-users {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  margin-left: auto;
  /* clear of the switch in the corner above */
  padding-top: 10px;
}

.row-users .mini-avatar {
  width: 34px;
  height: 34px;
  font-size: var(--fs-sm);
}

.row-users .avatar-chip.mini {
  padding: 2px;
}

.avatar-chip.mini {
  padding: 1px;
}

.mini-avatar {
  width: 22px;
  height: 22px;
  font-size: var(--fs-2xs);
}

.avatar-chip {
  position: relative;
  display: inline-flex;
  border-radius: 50%;
  padding: 2px;
  border: 1px solid var(--line-strong);
  background: var(--card);
  color: var(--ink);
  box-shadow: 0 1px 0 rgba(29, 33, 41, 0.12);
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}

/* A user who wrote the paper. Authors are squared off while every
   other user stays round, so the distinction survives without colour;
   gold is the app's "this person holds a role here" hue, as on the
   seminar leader's chip. */
.avatar-chip.author {
  border-radius: var(--radius);
  border-color: var(--gold);
  background: var(--gold-soft);
  box-shadow: 0 1px 0 rgba(29, 33, 41, 0.12);
}

/* Square the avatar inside to match the chip; the hover popup is the
   chip's other child and must keep its own shape. */
.avatar-chip.author > :not(.chip-pop) {
  border-radius: 1px;
}

.author-tag {
  margin-left: 6px;
  padding: 0 6px;
  background: var(--gold-soft);
  border-color: var(--gold-line);
  color: var(--gold-ink);
  font-family: var(--font-ui);
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  vertical-align: middle;
}

/* Inline variant of the standard checkbox row, for a rarely-set option
   that qualifies the line it trails rather than taking a row of its own. */
.checkbox-row.inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 12px;
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  font-style: normal;
  color: var(--ink-faint);
  vertical-align: middle;
}

.checkbox-row.inline input[type='checkbox'] {
  margin-top: 0;
}

.checkbox-row.inline:hover {
  color: var(--ink-soft);
}

.avatar-chip:hover {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
  transform: translateY(-1px);
  z-index: 30;
}

.avatar-chip.has-pop:hover .chip-pop {
  display: block;
}

.chip-pop-name {
  display: block;
  font-weight: 600;
  font-size: var(--fs-md);
}

.chip-pop-aff {
  display: block;
  font-size: var(--fs-xs);
  color: var(--ink-faint);
  margin-bottom: 6px;
}

.chip-pop-name + .rating-summary,
.chip-pop-aff + .rating-summary {
  margin-top: 6px;
}

.chip-pop {
  display: none;
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 10;
  padding: 10px 14px;
  width: max-content;
  max-width: 280px;
  white-space: normal;
}

.nook-chip.has-pop:hover .chip-pop {
  display: block;
}

.nook-chip.has-pop:hover {
  z-index: 30;
}

.chip-pop {
  z-index: 30;
}

.chip-pop .rating-summary {
  flex-direction: column;
  gap: 4px;
  margin: 0;
}

.chip-pop .rating-item {
  display: flex;
  justify-content: space-between;
  gap: 14px;
}

.summary {
  margin: 10px 0;
  padding: 8px 12px;
  background: var(--accent-soft);
  border-radius: var(--radius);
}

.summary h4 {
  margin-bottom: 6px;
  font-size: var(--fs-sm);
  font-variant: small-caps;
  letter-spacing: 0.04em;
  color: var(--ink-soft);
}

.summary p {
  color: var(--ink);
  font-size: var(--fs-base);
  white-space: pre-wrap;
}

.paper-actions {
  display: flex;
  gap: 10px;
  margin: 12px 0 0;
}

.paper-actions .button,
.paper-actions button {
  width: 7.5rem;
  text-align: center;
}

.paper-actions .button {
  padding: 6px 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--card);
  text-decoration: none;
  color: var(--ink);
  font-size: var(--fs-xs);
  line-height: 1.5;
  box-shadow: 0 1px 0 rgba(29, 33, 41, 0.12);
}

/* Small buttons: these open the paper, they do not compete with the
   user's own work below them. */
.paper-actions button {
  padding: 6px 12px;
  font-size: var(--fs-xs);
  line-height: 1.5;
}

/* The anchor equivalent of button.primary: reading the paper is the action
   this page exists for. */
.paper-actions .button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--ink-inverse);
}

.paper-actions .button.primary:hover {
  background: var(--accent-strong);
  border-color: var(--accent-strong);
  color: var(--ink-inverse);
}

.paper-actions .button:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}

.share-control {
  position: relative;
}

.share-menu {
  position: absolute;
  z-index: 30;
  top: calc(100% + 6px);
  left: 0;
  width: 270px;
  padding: 7px;
}

/* The menu that hands over a link is wider than the menu of actions: it
   holds a URL, and a URL the user cannot read is a URL they cannot check
   before handing it over. */
.share-links-menu {
  width: 310px;
}

.paper-actions .share-menu > button,
.paper-actions .share-menu > a {
  display: block;
  width: 100%;
  padding: 9px 10px;
  text-align: left;
  color: var(--ink);
  text-decoration: none;
}

.paper-actions .share-menu > button:hover:not(:disabled),
.paper-actions .share-menu > a:hover {
  background: var(--accent-soft);
}

.share-menu button strong,
.share-menu button span,
.share-menu a strong,
.share-menu a span {
  display: block;
}

.share-menu button span,
.share-menu a span {
  margin-top: 2px;
  color: var(--ink-faint);
  font-size: var(--fs-xs);
}

.share-link-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.share-link-row input {
  min-width: 0;
  flex: 1 1 auto;
  padding: 6px 7px;
  font-size: var(--fs-xs);
}

.paper-actions .share-link-row button {
  width: auto;
  flex: none;
}

.share-note {
  margin: 6px 3px 8px;
  color: var(--ink-faint);
  font-size: var(--fs-xs);
  line-height: 1.45;
}

.paper-actions .share-menu-section > button {
  width: auto;
  padding: 5px 9px;
  margin-left: 3px;
}

.signed-out-reviews {
  margin-top: 18px;
  color: var(--ink-soft);
  font-size: var(--fs-sm);
}

/* ---------- Seminar / interest ---------- */

.discussion-card {
  background: var(--paper);
  border-left: 4px solid var(--accent);
  padding: 20px 24px;
  margin-bottom: 20px;
}

.seminar-head {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  gap: 8px 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.seminar-head h4 {
  font-size: var(--fs-lg);
}

/* The one seminar-state chip, used identically everywhere */
.state-pill {
  display: inline-block;
  font-size: var(--fs-2xs);
  font-family: var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 500;
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  vertical-align: middle;
}

.state-pill.called {
  background: var(--accent);
  color: var(--ink-inverse);
}

.state-pill.planning {
  background: var(--gold);
  color: var(--ink-inverse);
}

.state-pill.scheduled {
  background: var(--green);
  color: var(--ink-inverse);
}

.state-pill.finished {
  background: var(--grey);
  color: var(--ink-inverse);
}

.state-pill.none {
  background: transparent;
  color: var(--ink-faint);
  border: 1px solid var(--line);
}

button.state-pill {
  border: none;
  box-shadow: none;
  cursor: pointer;
  line-height: inherit;
  transition: filter 0.15s, border-color 0.15s;
}

button.state-pill:hover:not(:disabled) {
  filter: brightness(0.92);
}

button.state-pill.called,
button.state-pill.called:hover:not(:disabled) {
  background: var(--accent);
  color: var(--ink-inverse);
}

button.state-pill.planning,
button.state-pill.planning:hover:not(:disabled) {
  background: var(--gold);
  color: var(--ink-inverse);
}

button.state-pill.scheduled,
button.state-pill.scheduled:hover:not(:disabled) {
  background: var(--green);
  color: var(--ink-inverse);
}

button.state-pill.finished,
button.state-pill.finished:hover:not(:disabled) {
  background: var(--grey);
  color: var(--ink-inverse);
}

button.state-pill.none {
  background: transparent;
  color: var(--ink-faint);
  border: 1px solid var(--line);
}

button.state-pill.none:hover:not(:disabled) {
  filter: none;
  color: var(--accent);
  border-color: var(--accent);
}

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  /* The same dusk the sheet's backdrop uses, so no two dialogs darken the
     page by different amounts. */
  background: rgba(29, 33, 41, 0.42);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  overscroll-behavior: contain;
}

.modal-box {
  width: 100%;
  max-width: 560px;
  max-height: 85vh;
  max-height: 85dvh;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.modal-box .panel {
  margin-bottom: 0;
  box-shadow: var(--shadow-overlay);
}

.admin-message-dialog {
  max-width: 520px;
}

/* Papol speaking for itself, so its kicker takes the accent. */
.admin-message-dialog .kicker {
  margin-bottom: var(--space-1);
  color: var(--accent);
}

.admin-message-content {
  margin-bottom: var(--space-4);
  font-size: var(--fs-lg);
  line-height: 1.65;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.admin-message-dialog .form-actions {
  justify-content: flex-end;
}

.admin-message-audience {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
  margin: 0 0 var(--space-4);
  padding: 0;
  border: 0;
}

.admin-message-audience .form-label,
.admin-recipient-picker > label {
  width: 100%;
  margin-bottom: var(--space-1);
  color: var(--ink-soft);
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
  font-variant: small-caps;
  letter-spacing: 0.04em;
}

.admin-message-audience .form-label {
  grid-column: 1 / -1;
}

.admin-message-audience .checkbox-row {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--card);
  font-family: var(--font-ui);
  font-size: var(--fs-md);
}

.admin-message-audience input[type='radio'] {
  width: 15px;
  height: 15px;
  margin-top: 3px;
  accent-color: var(--accent);
}

.admin-message-audience small,
.admin-recipient-list small {
  display: block;
  color: var(--ink-faint);
  font-size: var(--fs-xs);
  font-weight: normal;
}

.admin-recipient-picker {
  margin-bottom: var(--space-4);
  padding: var(--space-3);
  border: 1px solid var(--accent-line);
  border-radius: var(--radius);
  background: var(--accent-soft);
}

.admin-recipient-picker > input {
  margin-bottom: var(--space-2);
}

.admin-recipient-count {
  margin-bottom: var(--space-2);
  color: var(--accent);
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
}

.admin-recipient-list {
  max-height: 260px;
  overflow-y: auto;
  margin: 0;
  padding: var(--space-1);
  border: 1px solid var(--accent-line);
  border-radius: var(--radius);
  background: var(--card);
  list-style: none;
}

.admin-recipient-list li + li {
  border-top: 1px solid var(--line);
}

.admin-recipient-list .checkbox-row {
  padding: var(--space-2);
  font-family: var(--font-ui);
  font-size: var(--fs-md);
}

@media (max-width: 560px) {
  .admin-message-audience {
    grid-template-columns: 1fr;
  }
}

h4 .state-pill {
  margin-left: 8px;
}

.interest-count-note {
  font-size: var(--fs-md);
  color: var(--ink-soft);
  margin: 8px 0;
}

.inline-edit {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.inline-edit-box {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  font: inherit;
  font-size: var(--fs-base);
  /* Tighter than the 1.65 body prose it inherits: in a composer the line
     breaks are the user's own structure — Markdown lists, headings — and
     reading-width leading spreads a short note over half the panel. */
  line-height: 1.4;
  background: var(--card);
  color: var(--ink);
  resize: vertical;
}

/* Sized by components/AutoTextarea.jsx as the user types. Past a
   screenful it stops growing and scrolls, so Save never leaves the view;
   the corner handle goes, since the box already sizes itself. */
.inline-edit-box.auto-grow {
  max-height: 60vh;
  overflow-y: auto;
  resize: none;
}

.inline-edit-actions {
  display: flex;
  gap: 8px;
}

.chip-pop-thought {
  display: block;
  font-style: italic;
  font-size: var(--fs-sm);
  margin-top: 3px;
  color: var(--ink-soft);
}

.home-organize-item { padding: 8px 0; }
.home-organize-item + .home-organize-item { border-top: 1px solid var(--line); }
.home-organize-item strong { font-size: var(--fs-base); }
.home-organize-item p { margin-top: 2px; color: var(--ink-soft); font-size: var(--fs-sm); line-height: 1.55; }


/* The source link in the hero. A quiet annotation, not a call to action:
   it sits below the note and is meant to be found by someone looking
   for it. */
.home-source {
  display: inline-block;
  margin-top: 14px;
  width: 22px;
  height: 22px;
  color: var(--ink-faint);
  transition: color 0.12s ease;
}

.home-source:hover { color: var(--ink); }
.home-source svg { display: block; width: 100%; height: 100%; }

.comment-actions {
  display: inline-flex;
  gap: 12px;
}

.nooks-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 10px 0 4px;
}

.nooks-label,
.cohort-label {
  font-size: var(--fs-sm);
  color: var(--ink-soft);
}

.cohort-chips {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.cohort-chips .cohort-label {
  margin-right: 4px;
}

.seminar-card {
  border-left-width: 3px;
  padding: 12px 16px;
  margin: 12px 0;
}

.seminar-card.open {
  border-left-color: var(--accent);
}

.seminar-card.planning {
  border-left-color: var(--gold);
}

.seminar-card.scheduled {
  border-color: var(--green-line);
  border-left-color: var(--green);
  background: var(--green-soft);
}

.seminar-card.finished {
  border-left-color: var(--grey);
  background: var(--paper);
  color: var(--ink-faint);
}

.seminar-card.collapsed {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 16px;
  text-align: left;
  cursor: pointer;
  font: inherit;
  box-shadow: none;
}

.seminar-card.collapsed:hover {
  border-color: var(--ink-faint);
  background: var(--paper);
}

.collapsed-meta {
  color: var(--ink-faint);
  font-size: var(--fs-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0; /* let the flex item shrink so the ellipsis can kick in */
}

.collapsed-caret {
  margin-left: auto;
  color: var(--ink-faint);
}

.collapse-button {
  margin-left: 10px;
  padding: 0 8px;
  font-size: var(--fs-2xl);
  line-height: 1;
  vertical-align: middle;
  color: var(--ink-soft);
}

.collapse-button:hover:not(:disabled) {
  color: var(--accent);
  background: none;
  border: none;
}

/* The announce/edit form is UI, not prose — use the interface font */
.announce-card,
.announce-card input,
.announce-card label {
  font-family: var(--font-ui);
}

/* The profile page is settings from top to bottom: nothing on it is prose
   the user wrote, it is all structured configuration, which the type
   roles put in the interface font. Same reasoning as .announce-card above,
   over a whole page rather than one card — and the reason the page read as
   a jumble was that its chrome was borrowing the prose face and then
   distinguishing itself with italics, small-caps and five sizes instead.
   Two faces with one job each: serif says heading, sans says control. */
.profile-page,
.profile-page input,
.profile-page label,
.profile-page select,
.profile-page button {
  font-family: var(--font-ui);
}

/* A heading is prose wherever it sits. */
.profile-page .panel-title {
  font-family: var(--font-serif);
}

/* The avatar is the same component everywhere; it should not change face
   because of the page it happens to be on. */
.profile-page .avatar-initial {
  font-family: var(--font-serif);
}

/* An address the user has to copy out exactly is an identifier, which
   the type roles give to the data face. It used to sit inside the field's
   label, where it needed a normal variant and a letter-spacing reset just
   to escape the small-caps kicker around it — four treatments in five
   words. In the sentence above the field it is simply prose and one
   identifier. Mono at --fs-sm beside --fs-md prose, as .md code does,
   because mono reads a size larger than it is set. */
.profile-page .confirm-address {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  color: var(--ink);
}

/* Explanatory text in a settings panel is an instruction, not an aside.
   Italic earns its keep on a one-line empty state; over three lines of
   sans it is just harder to read. */
.profile-page .panel-note,
.profile-page .avatar-hint {
  font-style: normal;
}

.local-setting-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 24px;
  align-items: center;
}

.local-setting-row label {
  display: block;
}

.local-setting-row select {
  min-width: 120px;
  padding: 7px 28px 7px 9px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background-color: var(--card);
  color: var(--ink);
  font-size: var(--fs-sm);
}

.local-sync-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
}

.local-sync-progress {
  margin-top: 14px;
}

/* The export's wait, where its "Downloaded" line will be. */
.export-progress {
  margin-bottom: 16px;
}

.local-sync-detail {
  margin-top: 6px;
  color: var(--ink-soft);
  font-size: var(--fs-sm);
}

.local-sync-detail.error {
  color: var(--red);
}

.local-storage-row {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}

.local-storage-totals {
  margin-top: 3px;
  color: var(--ink-faint);
  font-size: var(--fs-sm);
}

.local-storage-totals.error {
  color: var(--red);
}

.local-storage-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.panel-head-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.stage-actions {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}

.style-custom {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  flex: 1;
}

.style-custom-input {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  font: inherit;
  font-size: var(--fs-sm);
}

.style-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.style-option {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  cursor: pointer;
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
}

.style-option.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.style-option .style-desc {
  display: block;
  color: var(--ink-soft);
  font-size: var(--fs-sm);
}

.style-tag {
  margin-left: 10px;
  padding: 1px 9px;
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  color: var(--ink-soft);
  background: var(--card);
  vertical-align: middle;
}

.stage-style {
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
  margin-top: 6px;
}

.seminar-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.seminar-person {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: var(--fs-base);
  margin: 4px 0;
}

.seminar-when {
  font-size: var(--fs-lg);
  margin: 4px 0;
}

.seminar-where {
  color: var(--ink-soft);
}

.seminar-card h6 {
  font-size: var(--fs-sm);
  font-variant: small-caps;
  letter-spacing: 0.04em;
  color: var(--ink-soft);
  margin: 14px 0 6px;
}

/* ---------- Rooms & inbox ---------- */

a.button {
  display: inline-block;
  padding: 8px 18px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--card);
  color: var(--ink);
  text-decoration: none;
  font-size: var(--fs-md);
  box-shadow: 0 1px 0 rgba(29, 33, 41, 0.12);
}

a.button:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}

.room-kicker-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 2px;
}

/* In a row, the kicker's spacing comes from the row. */
.room-kicker-row .kicker {
  margin-bottom: 0;
}

.room-title {
  font-size: var(--fs-2xl);
}

.room-title a {
  color: var(--ink);
  text-decoration: none;
}

.room-title a:hover {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.stage-card {
  padding: 16px 18px;
  margin: 12px 0 16px;
}

.stage-card h5 {
  font-size: var(--fs-lg);
  margin-bottom: 4px;
}

.stage-card.open {
  background: var(--accent-soft);
  border-left: 4px solid var(--accent);
}

.stage-card.planning {
  background: var(--gold-soft);
  border-left: 4px solid var(--gold);
}

.stage-card.scheduled {
  background: var(--green-soft);
  border-left: 4px solid var(--green);
  border-color: var(--green-line);
}

.stage-card.finished {
  background: var(--paper);
  border-left: 4px solid var(--grey);
}

.stage-when {
  font-size: var(--fs-xl);
  font-weight: 600;
  margin-top: 4px;
}

.stage-where {
  color: var(--ink-soft);
}

.stage-hint {
  font-size: var(--fs-sm);
  font-style: italic;
  margin-top: 6px;
}

.stage-action {
  margin-top: 10px;
}

.join-chip {
  border: 0;
  padding: 6px 18px;
  font-size: var(--fs-base);
  font-weight: 600;
  color: var(--ink-inverse);
  background: var(--accent);
  box-shadow: 0 1px 3px rgba(29, 33, 41, 0.25);
}

.join-chip:hover:not(:disabled) {
  background: var(--accent);
  filter: brightness(0.93);
}

.participant-chip .chip-x {
  padding: 0 2px;
  margin-left: 2px;
  line-height: 1;
  font-size: var(--fs-base);
  color: var(--ink-faint);
  cursor: pointer;
}

.participant-chip .chip-x:hover:not(:disabled) {
  color: var(--red);
  background: none;
}

.leave-handoff {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 10px;
  font-size: var(--fs-md);
}

.leave-handoff select {
  padding: 5px 30px 5px 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background-color: var(--card);
  font: inherit;
  color: inherit;
}

.room-participants {
  margin-top: 14px;
}

.room-block {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}

.participant-chips {
  display: flex;
  flex-wrap: wrap;
  /* Centred, not stretched. The chips and the Join button are not the same
     height — a user chip carries an avatar and the button does not — and
     stretching lines up their tops, which is the one thing about them that
     should not have to agree. Worse, the button sits inside .hint-anchor,
     so stretching the anchor left the button itself at the anchor's top
     rather than the row's middle. */
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.participant-chip {
  gap: 8px;
  padding: 4px 12px 4px 5px;
  font-size: var(--fs-md);
}

.participant-chip:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.participant-chip.leader {
  background: var(--gold-soft);
  border-color: var(--gold);
  color: var(--ink);
}

.participant-chip.leader:hover {
  border-color: var(--gold);
  color: var(--ink);
}

/* A user without a picture shows their initial on a colour of their
   own, so two initials are told apart at a glance. Two classes, so these
   beat the plain size classes but still yield to role colouring such as
   the leader's gold below. */
.avatar-initial.avatar-tint-0 { background: var(--identity-0); }
.avatar-initial.avatar-tint-1 { background: var(--identity-1); }
.avatar-initial.avatar-tint-2 { background: var(--identity-2); }
.avatar-initial.avatar-tint-3 { background: var(--identity-3); }
.avatar-initial.avatar-tint-4 { background: var(--identity-4); }
.avatar-initial.avatar-tint-5 { background: var(--identity-5); }

.participant-chip.leader .entry-avatar {
  background: var(--gold);
  color: var(--ink-inverse);
}

.leader-star {
  color: var(--gold);
  font-size: var(--fs-xs);
}

.room-enter {
  display: flex;
  align-items: stretch;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 10px;
}

/* Open is an anchor and Uncall is a button. Give the paired controls an
   explicit shared leading so their boxes have the same height despite the
   body line-height inherited by the anchor. */
.room-enter .button,
.room-enter button {
  line-height: 1.5;
}

.call-block {
  margin-top: 4px;
}

.call-block .interest-count-note {
  margin-top: 8px;
}

.compose-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}

.compose-row .room-textarea {
  flex: 1;
  margin-bottom: 0;
  resize: none;
  min-height: 44px;
  line-height: 1.45;
  padding: 10px 12px;
}

.compose-row button {
  align-self: stretch;
  flex-shrink: 0;
}

.availability-all {
  list-style: none;
  margin-bottom: 4px;
}

.availability-all li {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: var(--fs-md);
  padding: 6px 0;
}

.availability-all li .entry-avatar {
  margin-top: 2px;
}

.availability-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.availability-text {
  color: var(--ink);
}

.availability-none {
  color: var(--ink-faint);
  font-style: italic;
}

.availability-edit {
  display: flex;
  gap: 8px;
  align-items: stretch;
}

.availability-edit input {
  flex: 1;
  padding: 7px 11px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  font-size: var(--fs-md);
  font-family: inherit;
  background: var(--card);
  color: var(--ink);
}

.availability-edit input:focus {
  outline: none;
  border-color: var(--accent);
}

.availability-edit button {
  flex-shrink: 0;
  padding: 6px 16px;
}

.announce-card {
  margin: 12px 0 16px;
  border-left: 3px solid var(--accent);
  padding: 14px 16px;
}

.announce-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 14px;
}

.room-messages {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: 0 0 var(--space-4);
  padding: 0;
  list-style: none;
}

.room-message {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
}

.room-message-body {
  flex: 1;
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}

.room-message-meta {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin-bottom: 2px;
  color: var(--ink-soft);
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
  line-height: 1.4;
}

.room-message-time {
  font-weight: normal;
}

.room-message-content {
  font-size: var(--fs-base);
  line-height: 1.55;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

/* ---------- Home ---------- */

.home-hero {
  text-align: center;
  padding: 40px 28px 34px;
}

.home-title {
  font-size: var(--fs-hero);
  letter-spacing: 0.04em;
  margin-bottom: 2px;
}

.home-subtitle {
  font-variant: small-caps;
  letter-spacing: 0.18em;
  color: var(--ink-soft);
  font-size: var(--fs-base);
}

.home-rule {
  border: none;
  border-top: 1px solid var(--line);
  width: 72px;
  margin: 18px auto;
}

.home-tagline {
  color: var(--ink-soft);
  max-width: 46ch;
  margin: 0 auto;
  line-height: 1.7;
}

/* ---------- About ---------- */

/* A page of prose panels: a kicker naming each section and a paragraph or
   two beneath it, set like the organize items on the home page so the two
   pages read as one site. The prose is the only thing on the page, so a
   line is held to a readable measure whatever the window's width. */
/* One story, read at the tagline's pace rather than a list's: the
   hero's measure and leading, the first paragraph a shade larger and
   darker, the rest following at a paragraph's distance. */
.about-story p {
  color: var(--ink-soft);
  font-size: var(--fs-base);
  line-height: 1.7;
  max-width: 58ch;
}

.about-story p + p { margin-top: 14px; }

.about-story .about-lede {
  color: var(--ink);
  font-size: calc(var(--fs-base) * 1.1);
  margin-top: 6px;
}

.about-story a {
  color: var(--accent);
  text-underline-offset: 3px;
}

/* ---------- Seminar flow diagram ---------- */

.flow-list {
  list-style: none;
  margin-top: 6px;
}

.flow-list li {
  display: flex;
  gap: 16px;
  padding: 10px 0;
  position: relative;
}

.flow-list li:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 14px;
  top: 40px;
  bottom: -12px;
  width: 1px;
  background: var(--line);
}

.flow-dot {
  width: 29px;
  height: 29px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-sm);
  background: var(--card);
  border: 1px solid var(--line-strong);
  color: var(--ink-soft);
  flex-shrink: 0;
  position: relative;
  z-index: 1;
}

.flow-dot.live {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--ink-inverse);
}

.flow-dot.gold {
  background: var(--gold);
  border-color: var(--gold);
  color: var(--ink-inverse);
}

.flow-dot.done {
  background: var(--green);
  border-color: var(--green);
  color: var(--ink-inverse);
}

.flow-body {
  flex: 1;
  min-width: 0;
  padding-top: 3px;
}

.flow-step-title {
  font-weight: 600;
  font-size: var(--fs-base);
  /* The pill is the whole line here, so let it be the line rather than an
     inline-block sitting on a baseline inside a taller one — that leading
     is what left it two points low against the step's numbered dot. */
  display: flex;
  align-items: center;
}

.flow-step-desc {
  font-size: var(--fs-sm);
  color: var(--ink-soft);
  margin-top: 2px;
  line-height: 1.55;
}

.inbox-badge {
  background: var(--accent);
  color: var(--ink-inverse);
  margin-left: 6px;
}

.notification-list {
  list-style: none;
}

.notification-item {
  padding: 12px 8px;
  border-bottom: 1px solid var(--line);
  cursor: pointer;
  transition: background 0.15s;
}

.notification-item:last-child {
  border-bottom: none;
}

.notification-item:hover {
  background: var(--accent-soft);
}

/* The whole notification is its button: it keeps the row's look, and only
   gains the ability to be reached from the keyboard. */
.notification-toggle,
.notification-toggle:hover:not(:disabled) {
  display: block;
  width: 100%;
  padding: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.notification-toggle .notification-content,
.notification-toggle .notification-date {
  display: block;
}

.notification-item.unread {
  background: var(--accent-soft);
  border-left: 3px solid var(--accent);
  padding-left: 9px;
}

.notification-item.unread .notification-content {
  font-weight: 600;
}

.notification-new {
  display: inline-block;
  margin-right: 8px;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--ink-inverse);
  font-family: var(--font-ui);
  font-size: var(--fs-2xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  vertical-align: middle;
}

.notification-content {
  font-size: var(--fs-base);
}

/* Collapsed: a single teaser line; clicking expands (and de-news) it */
.notification-content.collapsed {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.notification-room-link {
  margin-top: 4px;
  font-size: var(--fs-md);
}

.notification-date {
  margin-top: 2px;
}

/* ---------- Admin ---------- */

.admin-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 16px;
}

.admin-tab {
  padding: 4px 12px;
  font-size: var(--fs-xs);
  font-family: var(--font-ui);
  border-radius: var(--radius-pill);
}

.admin-tab.active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--ink-inverse);
}

.admin-table-wrap {
  overflow-x: auto;
  margin-top: 8px;
}

.admin-table {
  border-collapse: collapse;
  font-size: var(--fs-xs);
  font-family: var(--font-mono);
  width: auto;
}

.admin-table th {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 2px solid var(--line);
  color: var(--ink-soft);
  white-space: nowrap;
}

/* Every column header is the button that sorts it, so the header still
   reads as a header — the arrow is the only thing the sort adds. */
.admin-table th button.admin-sort {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
}

.admin-table th button.admin-sort:hover {
  color: var(--ink);
}

/* The arrow keeps its place whether or not the column is the sorted one,
   so clicking a header never shifts the columns under the pointer. */
.admin-sort-arrow {
  display: inline-block;
  min-width: 8px;
  color: var(--accent);
}

.admin-table td {
  padding: 4px 6px;
  border-bottom: 1px solid var(--line);
  vertical-align: middle;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.admin-table td input {
  width: 100%;
  min-width: 56px;
  max-width: 100%;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  font: inherit;
  color: var(--ink);
  text-overflow: ellipsis;
}

.admin-table td input:hover {
  border-color: var(--line);
}

.admin-table td input:focus {
  outline: none;
  border-color: var(--accent);
  background: var(--card);
}

.admin-pk {
  color: var(--ink-faint);
  padding: 0 6px;
}

.paper-notes {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

.inline-thought {
  margin: 10px 0;
}

/* Public, so it carries the same green tint as the ratings. */
.inline-thought-text {
  margin: 0;
  padding: 8px 12px;
  background: var(--green-soft);
  border-radius: var(--radius);
  font-size: var(--fs-md);
  white-space: pre-wrap;
}

.inline-thought > .inline-edit {
  padding: 8px 12px;
  background: var(--green-soft);
  border-radius: var(--radius);
}

.inline-thought > .inline-edit .inline-edit-box {
  border-color: var(--green-line);
}

.inline-thought > .link-button,
.summary-block > .link-button {
  display: block;
  width: 100%;
  padding: 8px 12px;
  border-radius: var(--radius);
  text-align: left;
}

.inline-thought > .link-button {
  background: var(--green-soft);
  color: var(--green-ink);
}

/* Summary sits beside Notes as an equal: same heading level, and its
   text is carded like a note. */
.summary-block {
  margin-bottom: 14px;
}

.summary-text {
  padding: 8px 12px;
  background: var(--accent-soft);
  border-radius: var(--radius);
  font-size: var(--fs-md);
  white-space: pre-wrap;
}

.summary-block > .inline-edit {
  padding: 8px 12px;
  background: var(--accent-soft);
  border-radius: var(--radius);
}

.summary-block > .inline-edit .inline-edit-box {
  border-color: var(--accent-line);
}

.summary-block > .link-button {
  background: var(--accent-soft);
  color: var(--accent);
}

.paper-notes h4 {
  margin: 0 0 8px;
}

/* ---------- Markdown prose (summaries and notes) ---------- */

/* The user's own prose, rendered by components/Markdown.jsx. It carries
   its own line breaks, so it drops the pre-wrap the plain-text form leant
   on, and its first and last blocks sit flush inside the tinted card. */
.md {
  white-space: normal;
}

.md > :first-child {
  margin-top: 0;
}

.md > :last-child {
  margin-bottom: 0;
}

.md p {
  margin: 0 0 6px;
}

/* Headings inside a note are subordinate to the section heading above the
   card, so they start a step below body-emphasis and shrink from there. */
.md-heading {
  font-size: var(--fs-lg);
  margin: 10px 0 4px;
}

.md h5.md-heading {
  font-size: var(--fs-md);
}

.md h6.md-heading {
  font-size: var(--fs-md);
  color: var(--ink-soft);
}

.md-list {
  margin: 0 0 6px 18px;
}

.md-list .md-list {
  margin-bottom: 0;
}

.md-list li {
  margin-bottom: 2px;
}

/* Code sits on --card: on a tinted note that reads as an inset panel
   without needing a colour of its own. */
.md code {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 0 4px;
}

.md-code {
  margin: 0 0 6px;
  padding: 6px 9px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow-x: auto;
}

.md-code code {
  padding: 0;
  border: none;
  background: none;
  white-space: pre;
}

.md-quote {
  margin: 0 0 6px;
  padding-left: 10px;
  border-left: 2px solid var(--line-strong);
  color: var(--ink-soft);
}

.md-rule {
  border: none;
  border-top: 1px solid var(--line);
  margin: 8px 0;
}

/* The syntax reminder under an edit box: fine print, never competing with
   the Save it sits beside. */
.md-hint {
  margin: -2px 0 0;
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  color: var(--ink-faint);
}

.md-hint code {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--ink-soft);
}

.metrics-subtitle {
  margin-top: 16px;
}

.sql-error {
  margin-top: 12px;
}

.admin-statement {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  white-space: pre-wrap;
  word-break: break-word;
}

.admin-row-actions {
  white-space: nowrap;
}

.admin-row-actions button {
  padding: 3px 10px;
  font-size: var(--fs-xs);
  margin-right: 6px;
}

.admin-row-actions .link-button {
  font-size: var(--fs-xs);
}

.admin-sql {
  width: 100%;
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  background: var(--card);
  margin-bottom: 8px;
  resize: vertical;
}

.admin-sql:focus {
  outline: none;
  border-color: var(--accent);
}

.admin-sql-result {
  margin-top: 12px;
}

.feature-state-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.feature-state {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 0;
  border-top: 1px solid var(--line);
}

.feature-state:first-child {
  border-top: none;
  padding-top: 0;
}

.feature-state-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.feature-state-body span {
  font-size: var(--fs-sm);
  color: var(--ink-soft);
}

.feature-state-body code {
  font-family: var(--font-mono);
  font-size: var(--fs-2xs);
  color: var(--ink-faint);
}

/* ---------- Comments ---------- */

.comment-section h4 {
  margin-bottom: 14px;
}

.comment-compose {
  margin-bottom: 10px;
}

.comments-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.comments-list > .comment {
  padding: 6px 12px;
  background: var(--accent-soft);
  border-radius: var(--radius);
}

.comment-content {
  margin-bottom: 2px;
  white-space: pre-wrap;
  font-size: var(--fs-md);
}

/* Where a note sits in the PDF, and the way back to it. */
.note-page {
  font-family: var(--font-ui);
  font-size: var(--fs-2xs);
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  border: 1px solid var(--accent-line);
  color: var(--accent);
  text-decoration: none;
}

.note-page:hover { background: var(--card); }

.comment-footer {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  font-size: var(--fs-xs);
}

.comment-footer .note-page { justify-self: start; }
.comment-footer .comment-date { grid-column: 2; justify-self: center; }
.comment-footer .comment-actions { grid-column: 3; justify-self: end; }

.delete-comment-button {
  padding: 2px 8px;
  font-size: var(--fs-xs);
  color: var(--ink-faint);
}

.delete-comment-button:hover {
  color: var(--accent);
  background: none;
  border: none;
}

.no-comments, .panel-note {
  color: var(--ink-faint);
  font-style: italic;
}

.panel-note {
  margin-bottom: 16px;
  font-size: var(--fs-md);
}

.board-create { margin-top: 12px; }

body.board-workspace-open { overflow: hidden; }
body.board-workspace-open .app { max-width: none; padding: 0; }
body.board-workspace-open .app > .topnav,
body.board-workspace-open .feedback-button { display: none; }
body.board-workspace-open .main-content { display: block; padding: 0; }
.infinite-board { position: fixed; inset: 0; z-index: 100; overflow: hidden; background: var(--paper-sunken); font-family: var(--font-serif); }
.board-toolbar { position: absolute; inset: 0 0 auto; min-height: 55px; }
.board-toolbar button { padding: 6px 12px; border-radius: var(--radius); box-shadow: none; font-family: var(--font-ui); font-size: var(--fs-xs); line-height: 1.5; }
/* The way home, drawn as the house the desktop toolbar and the viewer both
   wear, so one glyph means one thing everywhere in Papol. */
/* The way back to where the board is kept, beside the house that leaves for
   Papol. Worded, because unlike the house it names what it returns to. */
/* ---------- A board's jacket ---------- */

/* Its one screen in the Library: what is known about the board, and the way
   in. Set like a paper's, because the two are the same kind of thing. */
.board-jacket-head { display: flex; align-items: center; gap: 10px; }
.board-jacket .board-jacket-name { flex: 1; min-width: 0; margin: 0; padding: 2px 6px; border: 1px solid transparent; border-radius: 6px; background: none; color: var(--ink); font-family: var(--font-serif); font-size: var(--fs-2xl); line-height: 1.2; }
.board-jacket input.board-jacket-name:hover { border-color: var(--line); }
.board-jacket input.board-jacket-name:focus { border-color: var(--accent); background: var(--card); outline: none; }
.board-jacket-facts { display: flex; align-items: center; flex-wrap: wrap; gap: 14px; margin: 0; color: var(--ink-faint); font-size: var(--fs-sm); }
.board-jacket .board-jacket-note { width: 100%; margin: 0; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); color: var(--ink); font-family: var(--font-serif); font-size: var(--fs-md); line-height: 1.55; resize: vertical; white-space: pre-wrap; }
.board-jacket textarea.board-jacket-note:focus { border-color: var(--accent); background: var(--card); outline: none; }
.board-jacket-actions { display: flex; gap: 10px; align-items: center; }

.board-toolbar-title { min-width: 100px; border: 1px solid transparent; padding: 6px 8px; background: transparent; color: var(--ink); font: 600 var(--fs-lg) var(--font-serif); }
.board-toolbar-title:focus { outline: none; border-color: var(--accent-line); background: var(--paper); }
.board-toolbar-title[readonly] { cursor: default; }
.board-toolbar-title[readonly]:focus { border-color: transparent; background: transparent; }
/* Stands in the row after the name rather than pinned to the bar's centre:
   pinned there, a long name or a narrow window (a tablet) ran the two into
   each other. It gives way first when the row is short of room. */
.board-toolbar-edited { flex: 0 100 auto; min-width: 0; overflow: hidden; color: var(--ink-faint); cursor: default; font: var(--fs-2xs) var(--font-ui); user-select: none; white-space: nowrap; text-overflow: ellipsis; }
@media (max-width: 900px) { .board-toolbar-edited { display: none; } }
.board-readonly-badge { border-color: var(--line-strong); background: var(--paper); color: var(--ink-soft); }
.board-toolbar-spacer { flex: 1; }
.board-toolbar .board-tidy-button { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line-strong); background: var(--card); color: var(--ink-soft); }
.board-toolbar .board-tidy-button:hover:not(:disabled), .board-toolbar .board-tidy-button:focus-visible { border-color: var(--accent); outline: none; background: var(--accent-soft); color: var(--accent); }
.board-tidy-glyph { width: 18px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.4; }
.board-actions-menu { position: relative; flex: none; }
.board-actions-menu summary { display: flex; align-items: center; justify-content: center; gap: 2px; width: 30px; height: 30px; border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--card); color: var(--ink-soft); cursor: pointer; list-style: none; }
.board-actions-menu summary::-webkit-details-marker { display: none; }
.board-actions-menu summary:hover, .board-actions-menu summary:focus-visible, .board-actions-menu[open] summary { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); outline: none; }
.board-actions-menu summary i { width: 3px; height: 3px; border-radius: 50%; background: currentColor; }
.board-actions-popover { position: absolute; z-index: 50; top: calc(100% + 5px); right: 0; min-width: 150px; padding: 4px; }
.board-toolbar .board-actions-popover button { width: 100%;color: var(--red); text-align: left; }
.board-toolbar .board-actions-popover button:hover:not(:disabled), .board-toolbar .board-actions-popover button:focus-visible { background: var(--red-soft); color: var(--red); }
.board-card-count { color: var(--ink-faint); font: var(--fs-xs) var(--font-ui); white-space: nowrap; }
.board-card-count strong { color: var(--ink-soft); font-weight: 650; }
.board-viewport { position: absolute; inset: 55px 0 0; overflow: hidden; touch-action: none; cursor: default; background-color: var(--paper-sunken); background-image: radial-gradient(circle, var(--line-strong) var(--board-grid-dot), transparent var(--board-grid-dot)); background-position: var(--board-grid-x) var(--board-grid-y); background-size: var(--board-grid-size) var(--board-grid-size); }
.board-viewport:active { cursor: default; }
.board-viewport.file-dragging { background-color: var(--accent-soft); }
.board-marquee { position: absolute; z-index: 3; border: 1px solid var(--accent); background: rgba(43,74,111,.1); pointer-events: none; }
.board-selection-menu { position: fixed; z-index: 45; top: 64px; left: 50%; display: flex; align-items: center; gap: 10px; transform: translateX(-50%); padding: 5px 6px 5px 12px; border-color: var(--accent-line); border-radius: var(--radius-pill); color: var(--ink-soft); font: var(--fs-xs) var(--font-ui); }
.board-selection-menu button { padding: 5px 10px; border: 0; border-radius: var(--radius-pill); background: var(--accent); color: white; box-shadow: none; font: 600 var(--fs-xs) var(--font-ui); }
.board-new-hint { position: fixed; z-index: 46; top: 66px; left: 50%; display: flex; align-items: center; gap: 12px; transform: translateX(-50%); max-width: min(520px, calc(100vw - 32px)); padding: 9px 10px 9px 14px; border-color: var(--accent-line); color: var(--ink-soft); font: var(--fs-sm) var(--font-ui); animation: board-hint-in .2s ease-out; }
.board-new-hint span { min-width: 0; }
.board-new-hint button { width: 24px; height: 24px; flex: none; padding: 0;border-radius: 50%;color: var(--ink-faint); font: var(--fs-lg) var(--font-ui); line-height: 1; }
@keyframes board-hint-in { from { opacity: 0; transform: translate(-50%, -6px); } }
.board-drop-target { position: fixed; z-index: 4; inset: 75px 20px 20px; display: grid; place-items: center; border: 2px dashed var(--accent-line); border-radius: var(--radius); background: rgba(234,239,245,.72); color: var(--accent); font: var(--fs-base) var(--font-ui); pointer-events: none; }
.board-stage { position: absolute; left: 0; top: 0; width: 1px; height: 1px; transform-origin: 0 0; will-change: transform; }
.board-booklet { --booklet-line: #8d99a8; position: absolute; z-index: 0; left: 0; top: 0; width: 24px; pointer-events: none; transition: height 180ms cubic-bezier(.22,.9,.3,1); }
.board-booklet::before { content: ''; position: absolute; top: 74px; bottom: 18px; left: 10px; width: 2px; border-radius: 2px; background: var(--booklet-line); }
.board-booklet::after { content: ''; position: absolute; top: 74px; left: 10px; width: 12px; height: 2px; border-radius: 2px; background: var(--booklet-line); }
.board-booklet-spine { position: absolute; z-index: 3; top: 66px; bottom: 8px; left: 0; width: 22px; padding: 0;border-radius: 8px;pointer-events: auto; cursor: grab; }
.board-booklet-spine:active { cursor: grabbing; }
.board-booklet-spine:hover:not(:disabled) { border: 0; background: color-mix(in srgb, var(--booklet-line) 9%, transparent); box-shadow: none; }
.board-booklet:has(.board-booklet-spine:hover), .board-booklet.selected { --booklet-line: var(--accent); }
.board-booklet.drop-active { --booklet-line: var(--accent); }
.board-booklet.drop-active::before { width: 3px; box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent) 12%, transparent); }
.board-booklet.drop-active .board-booklet-heading { border-bottom-color: var(--accent); }
.board-booklet.drop-active .board-booklet-title { color: var(--accent); }
.board-booklet.selected::before { width: 3px; box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 10%, transparent); }
.board-booklet.collection { box-sizing: border-box; pointer-events: auto; }
.board-booklet.collection::before { display: none; }
.board-booklet.collection::after { display: block; z-index: -1; top: 76px; right: 0; bottom: 0; left: 0; box-sizing: border-box; width: auto; height: auto; border: 1px dashed var(--line-strong); border-radius: 14px; background: transparent; }
.board-booklet.collection.auto-arrange::after { border-style: solid; }
.board-booklet.collection.moving-active::after, .board-booklet.collection.drop-active::after { border-color: var(--accent); background: color-mix(in srgb, var(--accent-soft) 55%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 10%, transparent); }
.board-booklet.collection.moving-active { transition: none; }
.board-booklet.collection.selected::after { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 10%, transparent); }
.board-booklet.collection .board-booklet-spine { z-index: 1; inset: 76px 0 0; width: auto; border-radius: 14px; background: rgba(0,0,0,.001); cursor: grab; touch-action: none; }
.board-booklet.collection:has(.board-booklet-spine:hover)::after { border-color: var(--accent-line); }
.board-booklet.collection:has(.board-booklet-spine:active)::after { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 10%, transparent); }
.board-booklet.collection .board-booklet-heading { top: 0; left: 12px; width: calc(100% - 24px) !important; height: 36px; }
.board-booklet.collection .board-booklet-header { top: 36px; left: 12px; width: calc(100% - 24px) !important; }
.board-booklet.collection .board-booklet-title { color: var(--ink-soft); font-family: var(--font-ui); }
.board-booklet-heading { position: absolute; top: 0; left: 0; box-sizing: border-box; max-width: 420px; height: 36px; border-bottom: 1px solid var(--line-strong); pointer-events: none; }
.board-booklet-header { position: absolute; top: 36px; left: 0; box-sizing: border-box; max-width: 420px; height: 34px; pointer-events: none; }
.board-booklet-title { display: block; width: 100%; height: 35px; margin: 0; padding: 3px 5px; overflow: hidden; border: 1px solid transparent; border-radius: 6px 6px 0 0; background: transparent; box-shadow: none; color: var(--ink); font: 650 var(--fs-xl) var(--font-serif); text-align: left; text-overflow: ellipsis; white-space: nowrap; pointer-events: auto; }
.board-booklet-title:is(button) { cursor: grab; }
.board-booklet-title:is(button):active { cursor: grabbing; }
.board-booklet-title:hover { border-color: var(--line-strong); background: color-mix(in srgb, var(--card) 88%, transparent); }
.board-booklet-title:focus { outline: 2px solid var(--accent-soft); border-color: var(--accent); background: var(--card); }
.board-booklet-title.empty { color: var(--ink-faint); font-style: italic; }
.board-booklet-header-text { display: block; width: 100%; height: 33px; margin: 0; padding: 6px 5px; overflow: hidden; resize: none; border: 1px solid transparent; border-radius: 0 0 6px 6px; background: transparent; box-shadow: none; color: var(--ink-soft); font: var(--fs-sm) var(--font-serif); line-height: 1.35; text-align: left; white-space: pre-wrap; pointer-events: auto; }
.board-booklet-header-text:is(button) { cursor: grab; }
.board-booklet-header-text:is(button):active { cursor: grabbing; }
.board-booklet-header-text:hover { border-color: var(--line-strong); background: color-mix(in srgb, var(--card) 88%, transparent); }
.board-booklet-header-text:focus { outline: 2px solid var(--accent-soft); border-color: var(--accent); background: var(--card); }
.board-booklet-header-text.empty { color: var(--ink-faint); font-family: var(--font-ui); font-size: var(--fs-xs); font-style: italic; }
.board-booklet-branch { position: absolute; z-index: 4; left: 10px; height: 1px; border-radius: 1px; background: var(--booklet-line); pointer-events: auto; transition: transform 180ms cubic-bezier(.22,.9,.3,1); }
.board-booklet-branch::before { content: ''; position: absolute; inset: -15px 0; }
.board-card-drag-handle { position: absolute; z-index: -1; top: -5px; left: -5px; display: grid; width: 58px; height: 54px; place-items: center; padding: 0; border: 2px solid var(--ink-faint); border-radius: 18px 9px 16px 7px; backface-visibility: hidden; background: linear-gradient(145deg, var(--card) 8%, var(--paper) 78%); box-shadow: inset 2px 2px rgba(255,255,255,.72), 2px 4px 9px rgba(29,33,41,.22); opacity: 0; pointer-events: none; transform: translate3d(9px, 8px, 0) rotate(-2deg) scale(.62); transform-origin: bottom right; will-change: transform, opacity; cursor: grab; transition: opacity .16s ease, transform .2s cubic-bezier(.2,.85,.25,1.15), border-color .14s ease, box-shadow .14s ease, z-index 0s .16s; }
.board-card-drag-handle span { width: 27px; height: 23px; border-radius: 7px; backface-visibility: hidden; background: repeating-linear-gradient(0deg, var(--ink-faint) 0 2px, transparent 2px 6px); opacity: .82; transform: translateZ(0); }
.board-card-drag-handle.grip-visible, .board-card-drag-handle:hover, .board-card-drag-handle:focus-visible, .board-card-drag-handle:active { opacity: 1; pointer-events: auto; transform: translate3d(-18px, -15px, 0) rotate(-5deg) scale(1); }
.board-card-drag-handle:hover, .board-card-drag-handle:focus-visible { border-color: var(--accent); outline: none; box-shadow: inset 2px 2px rgba(255,255,255,.8), 3px 6px 13px rgba(43,74,111,.28); }
.board-card-drag-handle.grip-foreground { z-index: 4; transform: translate3d(-20px, -17px, 0) rotate(-3deg) scale(1.04); box-shadow: inset 2px 2px rgba(255,255,255,.84), 4px 8px 17px rgba(43,74,111,.3); transition: opacity .16s ease, transform .24s cubic-bezier(.18,.9,.25,1.18), border-color .14s ease, box-shadow .2s ease, z-index 0s; }
.board-canvas-card > .board-card-drag-handle.grip-dragging { z-index: 4; opacity: 1; pointer-events: auto; transform: translate3d(-20px, -17px, 0) rotate(-3deg) scale(1.04); }
.board-canvas-card.selected > .board-card-drag-handle:not(.grip-visible):not(.grip-dragging) { opacity: 0; pointer-events: none; transform: translate3d(9px, 8px, 0) rotate(-2deg) scale(.62); }
.board-card-drag-handle:active { cursor: grabbing; }
.board-canvas-card.booklet-reorder-peer { z-index: 3; transition: transform 180ms cubic-bezier(.22,.9,.3,1), box-shadow 180ms ease, scale 180ms ease; }
.board-canvas-card.booklet-reordering { z-index: 5; transition: none; box-shadow: 0 16px 36px rgba(29,33,41,.22); cursor: grabbing; }
.board-canvas-card { position: absolute; left: 0; top: 0; isolation: isolate; width: 300px; max-height: 520px; overflow: visible; border: 1px solid var(--line-strong); border-radius: 10px; background: var(--card); box-shadow: 0 2px 5px rgba(29,33,41,.09), 0 9px 24px rgba(29,33,41,.08); cursor: default; user-select: none; contain: layout style; will-change: transform; }
.board-canvas-card.selected { z-index: 2; outline: 2px solid var(--accent); outline-offset: 3px; border-color: var(--accent-line); border-radius: 10px; box-shadow: 0 6px 20px rgba(43,74,111,.16); }
.board-canvas-card.selected > .board-card-header,
.board-canvas-card.selected > .board-card-content { pointer-events: none; }
.board-canvas-card.selected .board-card-action-menu,
.board-canvas-card.selected .board-editable-text,
.board-canvas-card.selected .board-youtube-description,
.board-canvas-card.selected .board-inline-text-editor { pointer-events: auto; }
.board-canvas-card.selected > .board-card-content,
.board-canvas-card.selected > .board-card-content * { user-select: none; }
.board-card-header { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; min-height: 36px; padding: 5px 7px 5px 10px; border-bottom: 1px solid var(--line); border-radius: 9px 9px 0 0; background: color-mix(in srgb, var(--paper) 72%, var(--card)); }
.board-card-kind { display: inline-flex; align-items: center; gap: 7px; min-width: 0; color: var(--ink-faint); font: 650 var(--fs-2xs) var(--font-ui); letter-spacing: .045em; text-transform: uppercase; }
.board-card-kind i { display: inline-flex; width: 17px; height: 17px; align-items: center; justify-content: center; border: 1px solid var(--line-strong); border-radius: 5px; background: var(--card); color: var(--ink-soft); font-style: normal; font-size: 15px; font-weight: 700; line-height: 1; text-align: center; }
.board-canvas-card.youtube .board-card-kind i { padding-left: 1px; font-size: 11px; }
.board-canvas-card.excerpt .board-card-kind i svg { display: block; width: 14px; height: 14px; fill: currentColor; }
.board-canvas-card.webpage .board-card-kind i { font-weight: 900; -webkit-text-stroke: .7px currentColor; }
.board-card-action-menu .item-actions-surface { z-index: 4; scale: var(--board-ui-scale); transform-origin: top left; }
.board-card-action-menu.place-left-start .item-actions-surface { transform-origin: top right; }
.board-card-action-menu.place-right-end .item-actions-surface { transform-origin: bottom left; }
.board-card-action-menu.place-left-end .item-actions-surface { transform-origin: bottom right; }
.board-card-content { position: relative; z-index: 1; overflow: hidden; border-radius: 0 0 9px 9px; background: var(--card); }
.board-canvas-card img { display: block; width: 100%; max-height: 380px; object-fit: contain; background: var(--paper); pointer-events: none; }
.board-image-loading { display: grid; width: 100%; aspect-ratio: 4 / 3; place-items: center; background: var(--paper); }
.board-image-error { display: grid; width: 100%; min-height: 96px; place-items: center; color: var(--ink-faint); background: var(--paper); font: var(--fs-sm) var(--font-ui); }
.board-canvas-card.youtube .board-image-loading, .board-canvas-card.webpage .board-image-loading { aspect-ratio: 16 / 9; }
.board-link-placeholder { aspect-ratio: 16 / 9; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; background: var(--paper); color: var(--ink-soft); font: var(--fs-sm) var(--font-ui); }
.board-link-placeholder > span:first-child { color: var(--accent); font-size: 24px; }
.board-canvas-card.webpage img,
.board-canvas-card.youtube img { height: auto; max-height: none; object-fit: initial; background: transparent; }
.board-canvas-card p { margin: 0; padding: 14px; white-space: pre-wrap; user-select: text; cursor: text; }
.board-canvas-file { display: flex; align-items: center; gap: 10px; width: auto; margin: 0; padding: 16px 14px; overflow-wrap: anywhere; text-align: left; color: var(--accent); background: var(--card); font: var(--fs-sm) var(--font-ui); }
.board-canvas-file > span:first-child { display: grid; width: 28px; height: 28px; flex: none; place-items: center; border: 1px solid var(--accent-line); border-radius: 6px; background: var(--accent-soft); }
.board-resize-handle { position: absolute; z-index: 3; right: -7px; bottom: -7px; width: 14px; height: 14px; padding: 0; border: 1px solid var(--accent); border-radius: 50%; background: var(--card); box-shadow: 0 1px 3px rgba(29,33,41,.2); opacity: 0; pointer-events: none; cursor: nwse-resize; transition: opacity .14s ease, transform .14s ease; }
.board-canvas-card:hover > .board-resize-handle,
.board-canvas-card.selected > .board-resize-handle,
.board-resize-handle:focus-visible,
.board-resize-handle:active { opacity: 1; pointer-events: auto; }
.board-youtube-description { margin: 0; padding: 12px 14px; border-top: 1px solid var(--line); cursor: text; }
.board-editable-text { cursor: text; }
.board-canvas-card.comment .board-editable-text { -webkit-user-select: none; user-select: none; }
.board-youtube-description.empty { color: var(--ink-faint); font-family: var(--font-ui); font-size: var(--fs-xs); font-style: italic; }
.board-excerpt-source { display: block; margin: 0; padding: 10px 14px; border-top: 1px solid var(--line); color: var(--accent); background: var(--paper); font: var(--fs-xs) var(--font-ui); text-decoration: none; }
.board-excerpt-source:hover { text-decoration: underline; text-underline-offset: 2px; }
.board-excerpt-text { margin: 0; padding: 16px 16px 14px; border: 0; color: var(--ink); font: var(--fs-sm) var(--font-serif); line-height: 1.55; white-space: pre-wrap; -webkit-user-select: none; user-select: none; }
.board-staging { position: absolute; z-index: 20; top: 18px; right: 18px; display: flex; flex-direction: column; width: min(292px, calc(100vw - 36px)); max-height: calc(100% - 36px); overflow: hidden; border: 1px solid var(--line-strong); border-radius: var(--radius-lg); background: color-mix(in srgb, var(--card) 96%, transparent); box-shadow: 0 12px 34px rgba(29,33,41,.18); font-family: var(--font-ui); touch-action: auto; }
.board-staging > header { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 11px 13px 9px; border-bottom: 1px solid var(--line); }
.board-staging > header strong { color: var(--ink); font-size: var(--fs-sm); }
.board-staging > header span { color: var(--ink-faint); font-size: var(--fs-2xs); }
.board-staging-list { display: grid; gap: 9px; padding: 9px; overflow: auto; }
.board-staging-card { min-width: 0; overflow: hidden; box-shadow: 0 2px 7px rgba(29,33,41,.08); cursor: grab; user-select: none; }
.board-staging-card:active { cursor: grabbing; }
.board-staging-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 9px; border-bottom: 1px solid var(--line); background: var(--paper); }
.board-staging-kind { color: var(--accent); font-size: var(--fs-2xs); font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.board-staging-drag { color: var(--ink-faint); font-size: var(--fs-2xs); }
.board-staging-card blockquote { display: -webkit-box; margin: 0; padding: 11px 12px; overflow: hidden; color: var(--ink); font: var(--fs-sm) var(--font-serif); line-height: 1.45; overflow-wrap: anywhere; white-space: pre-wrap; -webkit-box-orient: vertical; -webkit-line-clamp: 5; }
.board-staging-card > img { display: block; width: auto; height: auto; max-width: 100%; max-height: 170px; margin: 0 auto; object-fit: contain; background: var(--paper); }
.board-staging-image-loading { display: grid; min-height: 96px; place-items: center; background: var(--paper); }
.board-staging-comment { display: -webkit-box; margin: 0; padding: 8px 10px; overflow: hidden; border-top: 1px solid var(--line); color: var(--ink-soft); font: var(--fs-xs) var(--font-serif); line-height: 1.4; overflow-wrap: anywhere; white-space: pre-wrap; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
.board-staging-card footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; padding: 5px 7px 5px 10px; border-top: 1px solid var(--line); }
.board-staging-card a { min-width: 0; overflow: hidden; color: var(--accent); font-size: var(--fs-2xs); text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
.board-staging-card a:hover { text-decoration: underline; }
.board-staging-card button { flex: none; width: 24px; height: 24px; padding: 0;color: var(--ink-faint); font-size: var(--fs-lg); line-height: 1; }
.board-inline-text-editor { width: 100%; margin-top: 8px; border: 1px solid var(--accent); border-radius: var(--radius); background: var(--card); overflow: hidden; }
.board-inline-description { display: block; width: 100%; margin: 0; padding: 7px; resize: vertical; border: 0; border-radius: 0; background: var(--card); color: var(--ink); font: var(--fs-sm) var(--font-serif); user-select: text; }
.board-inline-description:focus { outline: 2px solid var(--accent-soft); }
.board-inline-format { display: flex; gap: 2px; padding: 3px; border-bottom: 1px solid var(--line); background: var(--paper); }
.board-inline-format button { width: 27px; min-width: 27px; padding: 3px 5px;color: var(--ink-soft); font-size: var(--fs-base); line-height: 1; }
.board-inline-format button:nth-child(1) { text-align: left; }
.board-inline-format button:nth-child(2) { text-align: center; }
.board-inline-format button:nth-child(3) { text-align: right; }
.board-inline-format button.active { background: var(--accent-soft); color: var(--accent); }
.board-align-glyph { display: block; width: 18px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; }
.board-youtube-loading .board-placeholder-progress { width: 240px; }
.board-youtube-loading { position: absolute; left: 0; top: 0; display: flex; align-items: center; justify-content: center; gap: 10px; width: 300px; min-height: 170px; border: 1px solid var(--line); border-radius: 2px; background: var(--card); color: var(--ink-soft); box-shadow: 0 1px 6px rgba(25,35,50,.18); user-select: none; touch-action: none; font: var(--fs-sm) var(--font-ui); will-change: transform; }
.board-canvas-error { position: fixed; z-index: 120; top: 68px; left: 50%; transform: translateX(-50%); padding: 8px 14px; background: var(--red-soft); color: var(--red); border: 1px solid var(--red-line); }

@media (prefers-reduced-motion: reduce) {
  .board-booklet,
  .board-booklet-branch,
  .board-card-drag-handle,
  .board-canvas-card.booklet-reorder-peer { transition-duration: 0ms; }
}

@media (max-width: 700px) {
  .board-toolbar { gap: 6px; min-height: 55px; padding: 7px 10px; overflow: visible; }
  .board-toolbar .board-home { width: 40px; height: 40px; }
  .board-toolbar-title { flex: 1; width: 0; min-width: 0; max-width: none; padding-inline: 5px; overflow: hidden; text-overflow: ellipsis; }
  .board-toolbar-edited,
  .board-toolbar > .experimental-badge { display: none; }
  .board-card-count { display: none; }
  .board-toolbar-spacer { display: none; }
  .board-toolbar .board-tidy-button { width: 40px; height: 40px; padding: 0; justify-content: center; }
  .board-tidy-button span { display: none; }
  .board-actions-menu summary { width: 40px; height: 40px; }
  .board-actions-popover { top: calc(100% + 3px); min-width: 170px; }
  .board-toolbar .board-actions-popover button { min-height: 42px; }
  .board-selection-menu { top: 63px; width: max-content; max-width: calc(100vw - 20px); justify-content: center; flex-wrap: wrap; gap: 6px; padding: 6px 7px 6px 10px; border-radius: 12px; }
  .board-selection-menu button { min-height: 36px; padding: 7px 11px; }
  .board-new-hint { top: 63px; width: calc(100vw - 20px); font-size: var(--fs-xs); }
  .board-new-hint button { width: 32px; height: 32px; }
  .board-card-action-menu .item-actions-surface { top: 8px; right: 0; bottom: auto; left: auto; transform-origin: top right; }
  .board-resize-handle { right: -14px; bottom: -14px; width: 28px; height: 28px; scale: var(--board-ui-scale); }
  .board-booklet-spine { left: calc(-6px * var(--board-ui-scale)); width: calc(32px * var(--board-ui-scale)); }
  .board-inline-format button { width: 36px; min-width: 36px; min-height: 34px; }
  .board-inline-description { font-size: 16px; }
  .board-staging { top: 10px; right: 10px; width: min(290px, calc(100vw - 20px)); max-height: 48%; }
  .board-canvas-error { top: 63px; width: calc(100vw - 20px); }
}

@media (max-width: 560px) {
  .shelf-manager-row {
    grid-template-columns: 30px minmax(0, 1fr);
  }

  .shelf-manager-row .shelf-visibility-toggle,
  .shelf-manager-row .shelf-default {
    grid-column: 2;
    justify-self: start;
  }

  .app {
    padding: 16px 12px 48px;
  }

  /* Masthead + tab bar: brand and account items on a centered top row,
     section links as a full-bleed, equal-cell tab bar beneath it whose
     active underline sits on the header's bottom rule */
  .topnav {
    align-items: center;
    row-gap: 0;
    padding-bottom: 0;
  }

  .topnav .whoami-name {
    display: none; /* the avatar alone is the profile link on phones */
  }

  .nav-avatar {
    margin-right: 0; /* no name after it on phones */
  }

  .topnav nav {
    order: 10;
    flex-basis: 100%;
    margin: 10px -12px 0;
    border-top: 1px solid var(--line);
    gap: 0;
  }

  /* Each tab takes its own words' width plus an equal share of what is
     left, on one line: an equal fifth of a phone was narrower than
     "Mac app" with its glyph, which broke onto two lines. */
  .topnav nav a {
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
    text-align: center;
    padding: 9px 2px;
    font-family: var(--font-ui);
    font-size: var(--fs-sm);
  }

  /* The announcement and its link each keep whole: the link drops to a
     second line rather than both breaking mid-sentence side by side. */
  .macos-download-banner {
    flex-wrap: wrap;
    row-gap: 2px;
  }

  /* The paper page's title and its authors get the whole width; the shelf
     control and the author checkbox go under them instead of squeezing
     the words into a column a few words wide. */
  .detail-title-row,
  .detail-authors-row {
    flex-wrap: wrap;
    gap: 8px 16px;
  }

  .detail-title-row h2,
  .detail-authors-row .authors {
    flex-basis: 100%;
  }

  .panel {
    padding: 16px;
  }

  .nook-header { margin-bottom: 14px; }
  .nook-header-row { display: grid; grid-template-columns: 48px minmax(0, 1fr); align-items: center; gap: 10px 14px; }
  .nook-header-actions { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); align-items: stretch; width: 100%; margin-left: 0; }
  .nook-header-actions .new-board-button { width: 100%; min-width: 0; justify-content: center; padding-right: 10px; }
  .nook-header-actions .upload-section.compact { width: 100%; min-width: 0; }
  .nook-header-actions .upload-section.compact .dropzone { height: 100%; }
  .board-create-fields { grid-template-columns: 1fr; }

  .nook > .paper-list { padding: 12px 10px; }
  .nook .paper-browser { margin: -12px -10px 0; }
  .nook .paper-browser-toggle { min-height: 44px; padding: 9px 12px; }
  .nook .paper-search-tools { padding: 3px 12px 12px; }
  .nook .paper-list li { gap: 8px; padding: 12px 8px 12px 24px; }
  .nook .paper-item h4 { font-size: var(--fs-md); line-height: 1.28; }
  .nook .paper-meta { margin-top: 3px; font-size: var(--fs-xs); line-height: 1.45; }
  .nook .row-users { max-width: 74px; gap: 4px; padding-top: 0; flex-wrap: wrap; justify-content: flex-end; }
  .nook .row-users .mini-avatar { width: 32px; height: 32px; }
  .nook .rating-summary.compact { flex-wrap: nowrap; gap: 10px; margin-top: 8px; white-space: nowrap; }
  .nook .rating-summary.compact .rating-item { gap: 4px; }
  .nook .rating-summary.compact .rating-dots { display: none; }
  .nook .rating-summary.compact .rating-number { display: inline; }

  /* Back button gets its own row above the auth card instead of being
     squeezed into the sliver beside it */
  .auth-page {
    flex-wrap: wrap;
  }

  /* Search input keeps a usable width; the sort control drops below it */
  .search-bar {
    flex-wrap: wrap;
  }

  .search-bar input {
    flex-basis: 100%;
  }

  .library-page .panel.paper-list { padding: 12px 10px 8px; }
  .library-user-filters { margin-inline: -2px; padding-inline: 2px; padding-bottom: 7px; }
  .user-filter { min-height: 38px; padding: 5px 10px; }
  .user-filter-avatar { width: 24px; height: 24px; }
  .library-search-line { flex-direction: row; align-items: center; gap: 8px; }
  .library-search-line > input { flex: 1 1 0; width: 0; min-height: 42px; }
  .library-search-line .sort-control { flex: none; width: auto; gap: 4px; font-size: var(--fs-xs); }
  .library-search-line .sort-control select { width: 130px; min-width: 0; min-height: 42px; }
  .library-page .grouped-papers { margin-top: 2px; }
  .library-page .paper-group { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 6px 10px; padding: 13px 8px; }
  .library-page .paper-group-head { min-width: 0; }
  .library-page .paper-title-row h4 { font-size: var(--fs-md); line-height: 1.28; }
  .library-page .paper-meta { margin-top: 3px; font-size: var(--fs-xs); line-height: 1.45; }
  .library-page .entry-chips { max-width: 76px; align-content: center; gap: 5px; }
  .library-page .avatar-chip { align-self: center; }
  .library-page .paper-list li.nook-board-row::before { inset: 0; }

  .paper-actions {
    flex-wrap: wrap;
  }

  /* Rows wrap uniformly: the trailing element (paper status pill, user
     affiliation) always sits on its own line instead of wrapping only
     when the title or name happens to be long */
  h4 .state-pill {
    display: block;
    width: fit-content;
    margin: 4px 0 2px;
  }

  .paper-title-row {
    flex-wrap: wrap; /* only here, and only so the chips below can wrap */
  }

  .paper-title-row .title-chips {
    flex-basis: 100%; /* user chips get their own line in every row too */
  }

  .form-row {
    grid-template-columns: 1fr;
    gap: 0;
  }

  .rating-input-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .form-actions {
    flex-direction: column;
  }

  .form-actions button {
    width: 100%;
  }
}
${desktopStyles}

/* Product-wide motion preference. Component media rules can remove layout
   transitions more selectively, while this guarantees that no newly added
   animation escapes the user's operating-system preference. */
`;
