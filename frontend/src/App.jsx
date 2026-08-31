import React, { useState, useEffect, useRef } from 'react';
import {
  getMe, getToken, setToken, logout, getNotifications, sendPresence,
} from './api';
import AuthPage from './components/AuthPage';
import Space from './components/Space';
import PaperDetail from './components/PaperDetail';
import { demoActive, enterDemo, exitDemo } from './demo';
import ProfilePage from './components/ProfilePage';
import PapersPage from './components/PapersPage';
import RoomPage from './components/RoomPage';
import InboxPage from './components/InboxPage';
import AdminPage from './components/AdminPage';
import HomePage from './components/HomePage';
import Avatar from './components/Avatar';
import FeedbackDialog from './components/FeedbackDialog';
import { appPath, stripAppBase } from './base';

export const styles = `
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

/* ---------- Design tokens (see frontend/DESIGN.md) ---------- */

:root {
  /* Ink — text, from strongest to faintest */
  --ink: #1d2129;
  --ink-soft: #4d5561;
  --ink-faint: #7e8794;

  /* Surfaces */
  --paper: #f5f6f8;
  --paper-sunken: #f1f3f6;
  --card: #ffffff;
  --line: #dde2e8;
  --line-strong: #b4becb;
  --ink-inverse: #ffffff;

  /* Neutral control fills (switch tracks and the like) */
  --fill: #ccd4dd;
  --fill-strong: #b8c2cf;

  /* Brand accent (navy) */
  --accent: #2b4a6f;
  --accent-strong: #1e3752;
  --accent-soft: #eaeff5;
  --accent-line: #c3cedd;

  /* Semantic hues: gold = planning/demo, green = live/public/success,
     red = danger/error, grey = finished/neutral state */
  --gold: #b3923d;
  --gold-ink: #7a5b1e;
  --gold-soft: #faf3e3;
  --gold-line: #e8d9b5;
  --green: #7ba26c;
  --green-ink: #3d5c34;
  --green-soft: #edf3ea;
  --green-line: #c9d9c1;
  --red: #8c2f22;
  --red-soft: #f9ecea;
  --red-line: #e5c4bd;
  --grey: #8a94a2;

  /* Identity colours — assigned per reader, not semantic. Used behind the
     initial shown when a reader has no picture; each is dark enough to
     carry white text. */
  --identity-0: #2b4a6f;
  --identity-1: #35606b;
  --identity-2: #4a6b52;
  --identity-3: #7a4030;
  --identity-4: #6b3f5e;
  --identity-5: #4b4f7a;

  /* Type families: serif for prose, UI sans for controls/badges/forms,
     mono for identifiers and data */
  --font-serif: Georgia, 'Iowan Old Style', 'Times New Roman', serif;
  --font-ui: -apple-system, 'Segoe UI', sans-serif;
  --font-mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;

  /* Type scale */
  --fs-2xs: 0.7rem;
  --fs-xs: 0.78rem;
  --fs-sm: 0.85rem;
  --fs-md: 0.92rem;
  --fs-base: 0.95rem;
  --fs-lg: 1.05rem;
  --fs-xl: 1.2rem;
  --fs-2xl: 1.4rem;
  --fs-3xl: 1.5rem;
  --fs-hero: 2.1rem;

  /* Corners */
  --radius: 3px;
  --radius-lg: 10px;
  --radius-pill: 999px;
}

body {
  font-family: var(--font-serif);
  background: var(--paper);
  color: var(--ink);
  line-height: 1.65;
}

h1, h2, h3, h4, h5, h6 {
  font-weight: 600;
  line-height: 1.3;
}

/* Links take their colour from the app, never from the browser's
   blue/purple/red link states — a chip flashing red on click is the
   browser's :active default leaking through. Anything that should look
   like a link says so with its own colour. */
a,
a:visited,
a:active {
  color: inherit;
}

/* No grey flash box when tapping a control on a touch screen. */
a,
button,
label,
input[type='checkbox'] {
  -webkit-tap-highlight-color: transparent;
}

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

.topnav nav a {
  color: var(--ink-soft);
  text-decoration: none;
  font-size: var(--fs-base);
  padding-bottom: 2px;
  border-bottom: 2px solid transparent;
}

.topnav nav a:hover {
  color: var(--accent);
  border-bottom-color: var(--line);
}

.topnav nav a.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

.topnav .inbox-link {
  color: var(--ink-soft);
  text-decoration: none;
  font-size: var(--fs-base);
  padding-bottom: 2px;
  border-bottom: 2px solid transparent;
}

.topnav .inbox-link:hover {
  color: var(--accent);
  border-bottom-color: var(--line);
}

.topnav .inbox-link.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

/* Always within reach, never in the way: the report door rides along in
   the bottom-right corner of every page. */
.feedback-fab {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 90;
  padding: 9px 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--card);
  color: var(--ink-soft);
  font: inherit;
  font-size: var(--fs-sm);
  cursor: pointer;
  box-shadow: 0 3px 12px rgba(25, 35, 50, 0.16);
}

.feedback-fab::after {
  content: '×';
  display: inline-block;
  width: 0;
  margin-left: 0;
  opacity: 0;
  overflow: hidden;
  transform: translateX(4px);
  transition: width 0.15s ease, margin-left 0.15s ease, opacity 0.15s ease, transform 0.15s ease;
}

.feedback-fab:hover {
  color: var(--accent);
  border-color: var(--accent);
  box-shadow: 0 4px 16px rgba(25, 35, 50, 0.22);
}

.feedback-fab:hover::after {
  width: 0.7em;
  margin-left: 6px;
  opacity: 1;
  transform: translateX(0);
}

/* The offer of a newer PDF: informational, never alarming, and never
   acted on without the reader. */
.edition-notice {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin: 0 0 18px;
  padding: 12px 14px;
  border: 1px solid var(--accent-line);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius-lg);
  background: var(--accent-soft);
}

.edition-notice-icon {
  flex: none;
  width: 20px;
  height: 20px;
  margin-top: 2px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--ink-inverse);
  font-size: var(--fs-sm);
  font-style: italic;
  font-weight: 600;
  line-height: 20px;
  text-align: center;
}

.edition-notice-head {
  margin: 0;
  color: var(--ink);
}

.edition-notice-actions {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.edition-notice-warn {
  margin: 4px 0 6px;
  font-size: var(--fs-sm);
  color: var(--ink-soft);
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

.demo-banner {
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

.demo-banner-actions {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  white-space: nowrap;
}

.demo-banner-btn {
  border: 1px solid var(--gold-ink);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--gold-ink);
  padding: 3px 14px;
  font-size: var(--fs-sm);
  box-shadow: none;
}

.demo-banner-btn:hover {
  background: var(--gold-ink);
  color: var(--ink-inverse);
}

.demo-banner-link {
  color: var(--gold-ink);
  font-size: var(--fs-sm);
  text-decoration: underline;
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
  border-radius: 50%;
  background: var(--accent);
  color: var(--ink-inverse);
  /* inline so the profile link keeps its text baseline (aligning with the
     rest of the row) while the avatar hangs centered beside the name */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  vertical-align: middle;
  font-size: var(--fs-xs);
  margin-right: 7px;
}

/* ---------- Generic ---------- */

.panel {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
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

/* The one panel a reader can do something irreversible in. It is marked
   by its edge rather than a wash of colour: the page is otherwise white
   panels, and a red one would read as an error the reader must fix. */
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

button {
  padding: 8px 18px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--card);
  color: var(--ink);
  cursor: pointer;
  font-size: var(--fs-md);
  font-family: inherit;
  box-shadow: 0 1px 0 rgba(25, 35, 50, 0.12);
  transition: all 0.15s;
}

button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}

button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--ink-inverse);
}

button.primary:hover:not(:disabled) {
  background: var(--accent-strong);
  color: var(--ink-inverse);
}

/* Danger action: red is the danger family, and this is a control the
   reader operates, so it takes the tint/line/ink roles rather than the
   saturated fill a primary button uses. */
button.danger {
  background: var(--red-soft);
  border-color: var(--red-line);
  color: var(--red);
}

button.danger:hover:not(:disabled) {
  background: var(--red-soft);
  border-color: var(--red);
  color: var(--red);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

button.full-width {
  width: 100%;
}

.link-btn {
  border: none;
  background: none;
  padding: 0;
  color: var(--accent);
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 3px;
  font-size: inherit;
  cursor: pointer;
  box-shadow: none;
}

.link-btn:hover {
  border: none;
  background: none;
  text-decoration-style: solid;
}

.error {
  background: var(--red-soft);
  color: var(--red);
  border: 1px solid var(--red-line);
  padding: 10px 14px;
  border-radius: var(--radius);
  margin-bottom: 16px;
  font-size: var(--fs-md);
}

.warning {
  background: var(--gold-soft);
  color: var(--gold-ink);
  border: 1px solid var(--gold-line);
  padding: 10px 14px;
  border-radius: var(--radius);
  margin-bottom: 16px;
  font-size: var(--fs-md);
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
  box-shadow: 0 3px 10px rgba(25, 35, 50, 0.15);
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

.loading {
  text-align: center;
  padding: 48px;
  color: var(--ink-faint);
  font-style: italic;
}

/* ---------- Forms ---------- */

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 4px;
  font-size: var(--fs-sm);
  color: var(--ink-soft);
  font-variant: small-caps;
  letter-spacing: 0.04em;
}

/* Every control inherits its context's type rather than falling back to
   a browser default — a bare <textarea> would otherwise render in
   monospace. Inheriting means a field picks up prose serif in a panel,
   mono inside an admin data table, and UI sans in the announce form. */
input,
textarea,
select {
  font-family: inherit;
  font-size: var(--fs-base);
  color: var(--ink);
}

.form-group input,
.form-group textarea,
.note-form textarea,
.availability-form textarea,
.room-textarea {
  width: 100%;
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  font-size: var(--fs-base);
  font-family: inherit;
  background: var(--card);
  color: var(--ink);
}

.form-group input:focus,
.form-group textarea:focus,
.note-form textarea:focus,
.availability-form textarea:focus,
.room-textarea:focus {
  outline: none;
  border-color: var(--accent);
}

.form-group textarea {
  resize: vertical;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 120px;
  gap: 16px;
}

.form-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 16px;
}

.pdf-row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

/* The PDF picked but not yet saved. */
.pdf-pending {
  font-size: var(--fs-xs);
  color: var(--ink-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The pair reads as one choice, so both boxes are the same size: one
   width for both, and an explicit line-height so the anchor and the button
   do not render at two different heights. Secondary controls in a form,
   so they take the small-button step of the scale rather than body size. */
.pdf-row .btn,
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

.market-status {
  font-size: var(--fs-md);
  color: var(--ink-soft);
  margin: 8px 0;
}

.market-status .visibility-badge {
  margin-left: 0;
  margin-right: 4px;
}

.market-toggle {
  padding: 2px;
  border: none;
  background: none;
  box-shadow: none;
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

.market-toggle.on .switch-text {
  color: var(--ink-inverse);
}

.market-toggle.off .switch-text {
  color: var(--ink-soft);
}

.market-toggle:hover:not(:disabled) {
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
.market-toggle.on .switch {
  padding: 0 4px 0 8px;
}

.market-toggle.on .switch-knob {
  order: 2;
}

.market-toggle.on .switch {
  background: var(--accent);
}

.market-toggle.off .switch {
  background: var(--fill);
}

.market-toggle.off:hover .switch {
  background: var(--fill-strong);
}

.switch-knob {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--ink-inverse);
  box-shadow: 0 1px 2px rgba(25, 35, 50, 0.3);
}

/* Text-less variant: fixed track, knob slides between the ends */
.market-toggle .switch.bare {
  width: 40px;
  padding: 0;
  position: relative;
}

.market-toggle .switch.bare .switch-knob {
  position: absolute;
  top: 3px;
  transition: left 0.15s;
}

.market-toggle.on .switch.bare .switch-knob {
  left: 21px;
}

.market-toggle.off .switch.bare .switch-knob {
  left: 3px;
}

/* ---------- Auth ---------- */

.auth-page {
  display: flex;
  justify-content: center;
  padding-top: 6vh;
}

.auth-card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
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

/* ---------- Directory ---------- */

.user-list {
  list-style: none;
}

.user-list li {
  padding: 12px 8px;
  border-bottom: 1px solid var(--line);
  cursor: pointer;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  transition: background 0.15s;
}

.user-list li:last-child {
  border-bottom: none;
}

.user-list li:hover {
  background: var(--accent-soft);
}

.user-list li:hover .user-name {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.user-name {
  font-size: var(--fs-lg);
}

.you-tag {
  color: var(--ink-faint);
  font-size: var(--fs-sm);
  font-style: italic;
}

.user-meta {
  color: var(--ink-faint);
  font-size: var(--fs-sm);
}

/* ---------- Space ---------- */

.space-header {
  margin-bottom: 20px;
}

.space-header h2 {
  font-size: var(--fs-2xl);
}

.space-subtitle {
  color: var(--ink-faint);
  font-size: var(--fs-md);
  font-style: italic;
}

.space-email {
  font-size: var(--fs-sm);
}

.space-email a {
  color: var(--ink-faint);
}

.space-email a:hover {
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

.upload-review-mode > .back-btn:not(.upload-review-back),
.upload-review-mode > .shelf-manager,
.upload-review-mode > .paper-list {
  display: none;
}

.upload-review-mode .space-header-row { display: block; }
.upload-review-mode .space-header-row > .space-avatar,
.upload-review-mode .space-header-row > .space-profile-copy,
.upload-review-mode .space-header-actions > .new-board-btn { display: none; }
.upload-review-mode .space-header-actions { display: block; width: 100%; margin: 0; }

.upload-review-mode .paper-form {
  padding: 18px;
}

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

.dropzone .hint {
  font-size: var(--fs-sm);
  color: var(--ink-faint);
  margin-top: 6px;
  font-style: italic;
}

.upload-section.compact { flex: 1 1 240px; min-width: 180px; }
.upload-section.compact .dropzone { display: grid; place-items: center; min-height: 48px; margin: 0; padding: 8px 12px; }
.upload-section.compact .dropzone p { margin: 0; font-family: var(--font-ui); font-size: var(--fs-xs); line-height: 1.35; }
.upload-section.compact .error { position: absolute; z-index: 10; width: min(360px, 100%); margin-top: 6px; }

/* ---------- Paper list ---------- */
.tag-editor { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
.tag-chip { border-radius: var(--radius-pill); padding: 4px 10px; box-shadow: none; }
.tag-chip.selected { background: var(--accent); border-color: var(--accent); color: var(--ink-inverse); }
.paper-browser { margin: -24px -24px 0; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--paper-sunken) 55%, var(--card)); font-family: var(--font-ui); }
.paper-browser-toggle { display: grid; grid-template-columns: max-content minmax(0, 1fr) 16px; align-items: center; gap: 10px; width: 100%; padding: 9px 24px; border: 0; border-radius: 0; background: transparent; box-shadow: none; color: var(--ink-soft); text-align: left; }
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
.library-reader-filters { display: flex; justify-content: flex-start; align-self: flex-start; width: 100%; gap: 6px; overflow-x: auto; padding-bottom: 10px; text-align: left; }
.library-reader-filters { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--line-strong) 45%, transparent) transparent; }
.library-reader-filters::-webkit-scrollbar { height: 1px; }
.library-reader-filters::-webkit-scrollbar-track { background: transparent; }
.library-reader-filters::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--line-strong) 45%, transparent); border-radius: var(--radius-pill); }
.reader-filter { display: inline-flex; align-items: center; justify-content: flex-start; flex: none; gap: 5px; padding: 3px 8px; border-radius: var(--radius-pill); box-shadow: none; font-family: var(--font-ui); font-size: var(--fs-xs); text-align: left; white-space: nowrap; }
.reader-filter.selected { background: var(--accent); border-color: var(--accent); color: var(--ink-inverse); }
.reader-filter-avatar { width: 20px; height: 20px; border-radius: 50%; }
.avatar-initial.reader-filter-avatar { display: inline-flex; align-items: center; justify-content: center; color: var(--ink-inverse); font-size: var(--fs-2xs); line-height: 1; text-align: center; }
.library-search-line { display: flex; align-items: center; gap: 12px; width: 100%; }
.library-search-line > input { flex: 1 1 auto; min-width: 0; }
.library-search-line .sort-control { flex: none; }
.paper-tags { margin: 0 0 14px; }
.tag-editor-card,
.upload-private-card { padding: 8px 12px; background: var(--accent-soft); border-radius: var(--radius); }
.upload-private-field > label { color: var(--accent); }
.upload-shelf-select { position: relative; padding: 6px; border-radius: var(--radius); background: var(--accent-soft); }
.upload-review-form .upload-shelf-select select { width: 100%; appearance: none; padding-right: 34px; border: 1px solid var(--accent-line); border-radius: var(--radius); background: var(--card); cursor: pointer; }
.upload-review-form .upload-shelf-select select:focus { outline: 0; border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.upload-shelf-select svg { position: absolute; top: 50%; right: 16px; width: 16px; height: 16px; transform: translateY(-50%); fill: none; stroke: var(--accent); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.upload-private-summary textarea { display: block; background: var(--card); border-color: var(--accent-line); }
.upload-private-summary textarea:focus { border-color: var(--accent); }
.upload-public-field > label { color: var(--green-ink); }
.upload-public-card { padding: 8px 12px; background: var(--green-soft); border-radius: var(--radius); }
.upload-public-thought input { background: var(--card); border-color: var(--green-line); }
.upload-public-thought input:focus { border-color: var(--green); }
.tag-picker { position: relative; font-family: var(--font-ui); }
.tag-editor { min-height: 34px; padding: 2px 6px; gap: 5px; background: var(--card); border: 1px solid var(--accent-line); border-radius: var(--radius); }
.tag-editor:focus-within { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.tag-editor .tag-chip { border: 1px solid var(--accent-line); background: var(--card); color: var(--accent-strong); padding: 2px 7px; font-family: var(--font-ui); font-size: var(--fs-sm); box-shadow: none; }
.tag-editor .tag-chip:hover { border-color: var(--red); color: var(--red); }
.tag-editor .tag-input { flex: 1 1 10rem; width: auto; min-width: 8rem; padding: 3px 2px; border: 0; background: transparent; box-shadow: none; font-size: var(--fs-sm); }
.tag-editor .tag-input:focus { outline: 0; box-shadow: none; }
.tag-dropdown { position: absolute; z-index: 20; top: calc(100% + 3px); left: 0; right: 0; overflow: hidden; padding: 3px; background: var(--card); border: 1px solid var(--accent-line); border-radius: var(--radius); box-shadow: 0 8px 18px rgba(34, 43, 54, .12); font-family: var(--font-ui); }
.tag-dropdown-label { padding: 4px 8px 2px; color: var(--ink-faint); font-size: var(--fs-2xs); font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
.tag-dropdown button { display: flex; width: 100%; gap: 7px; align-items: center; border: 0; border-radius: var(--radius); background: transparent; text-align: left; padding: 6px 8px; font-size: var(--fs-sm); }
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
.shelf-manager .icon-btn svg { display: block; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.shelf-manager-list { display: grid; gap: 5px; }
.shelf-manager-row { position: relative; display: grid; grid-template-columns: 26px minmax(8rem, 1fr) minmax(7rem, auto) minmax(5.5rem, auto); align-items: center; gap: 7px; padding: 6px 34px 6px 6px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--paper); }
.shelf-color-control { display: grid; place-items: center; }
.shelf-color-input { width: 22px; height: 22px; padding: 1px; border: 1px solid var(--line-strong); border-radius: 50%; background: var(--card); cursor: pointer; }
.shelf-name-block { display: grid; min-width: 0; }
.shelf-name-input { width: 100%; min-width: 0; padding: 2px 2px 3px; border: 0; border-bottom: 1px solid transparent; border-radius: 0; background: transparent; color: var(--ink); font-size: var(--fs-base); font-weight: 600; box-shadow: none; }
.shelf-name-input:hover { border-bottom-color: var(--line-strong); }
.shelf-name-input:focus { outline: 0; border-bottom-color: var(--accent); box-shadow: none; }
.shelf-visibility-toggle { justify-self: start; }
.shelf-default { display: inline-flex; justify-self: end; align-items: center; gap: 5px; color: var(--ink-soft); font-size: var(--fs-xs); white-space: nowrap; cursor: pointer; }
.shelf-default input { width: 14px; height: 14px; margin: 0; accent-color: var(--accent); }
.shelf-delete-btn { position: absolute; top: 50%; right: 5px; transform: translateY(-50%); color: var(--ink); }
.shelf-add { margin-top: 9px; font-size: var(--fs-xs); }
.nook-manager-section { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
.nook-manager-section-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 7px; }
.nook-manager-section-head h4 { font-size: var(--fs-base); }
.nook-manager-section-head p { color: var(--ink-faint); font-size: var(--fs-xs); }
.manage-tag-list { display: flex; flex-wrap: wrap; gap: 5px; }
.manage-tag-row { display: inline-flex; align-items: center; gap: 1px; padding-right: 2px; border: 1px solid var(--line); border-radius: var(--radius-pill); background: var(--paper); }
.manage-tag-row .tag-chip { border: 0; background: transparent; color: var(--ink-soft); font-size: var(--fs-xs); }
.manage-tag-row .icon-btn { width: 24px; height: 24px; }
.manage-tag-row .tag-delete-btn { color: var(--ink); }
.manage-tag-add { display: flex; gap: 6px; margin-top: 8px; }
.manage-tag-add input { flex: 1; min-width: 0; padding: 5px 8px; border: 1px solid var(--accent-line); border-radius: var(--radius); background: var(--card); font-family: var(--font-ui); font-size: var(--fs-sm); }
.manage-tag-add input:focus { outline: 0; border-color: var(--accent); }
.manage-tag-add button { padding: 5px 9px; font-size: var(--fs-xs); box-shadow: none; }
.shelf-bar { display: flex; align-items: stretch; padding: 7px 5px; }
.shelf-current { width: 8px; padding: 0; border: 0; border-radius: var(--radius-pill); background: var(--shelf-color); box-shadow: none; opacity: .82; transition: width .12s ease, opacity .12s ease; }
.shelf-current:hover, .shelf-current:focus-visible { width: 10px; opacity: 1; }
.shelf-palette { position: absolute; z-index: 15; top: 5px; right: 15px; min-width: 145px; padding: 4px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--card); box-shadow: 0 7px 18px rgba(34, 43, 54, .14); font-family: var(--font-ui); }
.shelf-palette button { display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 7px; border: 0; background: transparent; box-shadow: none; color: var(--ink-soft); font-size: var(--fs-xs); text-align: left; }
.shelf-palette button:hover, .shelf-palette button:focus-visible { background: var(--paper); }
.shelf-palette button.active { color: var(--ink); font-weight: 600; }
.shelf-palette button > span { width: 6px; height: 18px; border-radius: var(--radius-pill); }
.paper-shelf-picker { display: inline-flex; align-items: center; gap: 6px; }
.paper-shelf-picker label { color: var(--ink-soft); font-family: var(--font-ui); font-size: var(--fs-xs); }
.paper-shelf-picker select { max-width: 12rem; padding: 5px 24px 5px 7px; border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--card); color: var(--ink-soft); font-family: var(--font-ui); font-size: var(--fs-xs); }

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
  padding: 7px 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--card);
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
   withheld. Both are the tokens' own values — the bar is a saturated mark
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

/* A lane, which lights up under the cursor. The bar alone said "edge of a
   row"; a lane that answers to the pointer says "press here", and --paper
   is the token's own job — page ground and subtle hovers. */
.display-bar {
  width: 18px;
  padding: 0;
  border: none;
  border-radius: 0 var(--radius) var(--radius) 0;
  background: none;
  box-shadow: none;
  cursor: pointer;
  position: relative;
  transition: background 0.12s ease, box-shadow 0.12s ease;
}

/* Three steps, so the control announces itself before it is found rather
   than only once the cursor is already on it. Pointing anywhere at the row
   raises the lane faintly; pointing at the lane itself fills it and grows
   the pill; pressing sinks it. */
.paper-list li:hover .display-bar {
  background: var(--paper);
  /* A line down the lane's edge, not only a change of ground. Ground is
     the weaker half of this: a hidden row is already grey, so a tint can
     land within a few values of what it is drawn against and say nothing.
     A line has no such problem — it reads on white and on grey alike. */
  box-shadow: inset -1px 0 0 var(--line);
}

/* Written through .paper-list li so these outweigh the row-hover rule
   above it — that one carries an extra element in its selector, and would
   otherwise win against a bare .display-bar:hover and swallow both of
   these states. */
.paper-list li .display-bar:hover:not(:disabled),
.paper-list li .display-bar:focus-visible {
  background: var(--paper-sunken);
  /* An actual edge, not just a tint. --paper-sunken against --card is a
     couple of values apart and reads as nothing on its own; the line is
     what makes the lane look like a surface with a boundary, which is what
     a button looks like. */
  box-shadow: inset -1px 0 0 var(--line-strong);
}

.paper-list li .display-bar:active:not(:disabled) {
  background: var(--fill);
}

/* The paint, inside the target. */
.display-bar::before {
  content: '';
  position: absolute;
  left: 6px;
  /* Held clear of the row's edges so it reads as an object sitting in the
     lane rather than as the row's border. A border is scenery; a pill with
     air around it is a thing you can press. */
  top: 9px;
  bottom: 9px;
  width: 5px;
  border-radius: var(--radius-pill);
  transition: background 0.12s ease, left 0.12s ease, width 0.12s ease,
    top 0.12s ease, bottom 0.12s ease;
}

/* --green at its own strength. The family has four roles and no fifth: a
   faded green is not one of them, it is a new colour. */
.display-bar.on::before {
  background: var(--green);
}

/* Withheld: the same bar, broken. Dashed rather than hollow — at 3px wide
   an outline just reads as a thinner solid line, and dashed is what a
   hidden row already used to draw along this edge. */
.display-bar.off::before {
  background: repeating-linear-gradient(
    var(--line-strong) 0 5px,
    transparent 5px 10px
  );
  opacity: 1;
}

/* Under the cursor it grows into the lane it lives in. */
.display-bar:hover::before,
.display-bar:focus-visible::before {
  left: 5px;
  width: 7px;
  top: 5px;
  bottom: 5px;
}

.display-bar:active::before {
  top: 9px;
  bottom: 9px;
}

.display-bar.off:hover::before {
  background: repeating-linear-gradient(
    var(--ink-faint) 0 5px,
    transparent 5px 10px
  );
}

.display-bar:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
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
.board-create-shelf-select { position: relative; }
.board-create-shelf-select select { width: 100%; min-width: 0; appearance: none; padding: 9px 34px 9px 10px; border: 1px solid var(--accent-line); border-radius: var(--radius); background: var(--card); cursor: pointer; }
.board-create-shelf-select select:focus { outline: 0; border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.board-create-shelf-select svg { position: absolute; top: 50%; right: 11px; width: 16px; height: 16px; transform: translateY(-50%); fill: none; stroke: var(--accent); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
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

.interest-tag {
  font-size: var(--fs-sm);
  color: var(--accent);
  margin-top: 4px;
}

.paper-host {
  font-size: var(--fs-sm);
  color: var(--ink-faint);
  margin-top: 2px;
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

.group-count {
  font-size: var(--fs-xs);
  color: var(--accent);
  margin-top: 2px;
}

.reader-entries {
  list-style: none;
  margin-top: 8px;
}

.reader-entry {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 7px 8px;
  border-radius: var(--radius);
  cursor: pointer;
  transition: background 0.15s;
}

.reader-entry:hover {
  background: var(--accent-soft);
}

.reader-entry:hover .entry-name {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.entry-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--ink-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-xs);
  flex-shrink: 0;
}

.entry-name {
  font-size: var(--fs-md);
  min-width: 90px;
}

/* ---------- Avatars ---------- */

.avatar-img {
  object-fit: cover;
  background: var(--accent-soft);
}

/* Tall full-figure images (demo characters): crop around the head */
.avatar-img.head-crop {
  object-position: 50% 12%;
}

.user-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.space-header-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

.space-profile-copy { min-width: 0; }
.space-header-actions { display: flex; flex: 1 1 320px; align-items: flex-start; gap: 8px; min-width: 0; margin-left: auto; }
.new-board-btn { display: inline-grid; grid-template-columns: 22px auto; align-items: center; gap: 10px; min-height: 48px; padding: 7px 16px 7px 9px; font-family: var(--font-ui); font-size: var(--fs-md); font-weight: 400; text-align: left; white-space: nowrap; }
.new-board-mark { display: grid; grid-template-columns: repeat(2, 3px); place-content: center; gap: 3px; width: 22px; height: 22px; border: 1px solid var(--accent-line); border-radius: var(--radius); background: var(--paper); }
.new-board-mark i { width: 3px; height: 3px; border-radius: 50%; background: currentColor; }

.space-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--ink-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-xl);
  flex-shrink: 0;
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
  border-radius: 50%;
  background: var(--accent);
  color: var(--ink-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-3xl);
  flex-shrink: 0;
}

.avatar-buttons {
  display: flex;
  align-items: center;
  gap: 12px;
}

.avatar-hint {
  font-size: var(--fs-xs);
  color: var(--ink-faint);
  font-style: italic;
  margin-top: 4px;
}

.reader-entry .rating-summary.compact {
  margin: 0;
}

.danger-link {
  border: none;
  background: none;
  box-shadow: none;
  padding: 0;
  color: var(--red);
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 3px;
  font-size: var(--fs-md);
  margin-right: auto;
}

.danger-link:hover {
  border: none;
  background: none;
  color: var(--red);
  text-decoration-style: solid;
}



.summary-edit {
  margin-left: 10px;
  font-size: var(--fs-xs);
}

.add-summary {
  margin: 10px 0;
  font-size: var(--fs-md);
}

.no-papers {
  text-align: center;
  color: var(--ink-faint);
  padding: 20px;
  font-style: italic;
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
  border: none;
  background: none;
  box-shadow: none;
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

.rating-input-row label {
  font-size: var(--fs-md);
  color: var(--ink-soft);
  margin: 0;
}

.rating-buttons {
  display: flex;
  gap: 4px;
}

.rating-btn {
  width: 34px;
  height: 34px;
  padding: 0;
  border-radius: 50%;
  font-size: var(--fs-sm);
}

.rating-btn.selected {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--ink-inverse);
}

.rating-btn.none {
  border-style: dashed;
  color: var(--ink-faint);
}

.rating-btn.none.selected {
  background: var(--ink-soft);
  border-color: var(--ink-soft);
  border-style: solid;
  color: var(--ink-inverse);
}

.rating-hint {
  font-size: var(--fs-xs);
  color: var(--ink-faint);
  font-style: italic;
  margin-top: 2px;
}

.visibility-badge {
  display: inline-block;
  font-size: var(--fs-2xs);
  font-family: var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 1px 8px;
  border-radius: var(--radius-lg);
  border: 1px solid;
  margin-left: 8px;
  vertical-align: middle;
  font-style: normal;
  font-weight: 500;
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

.inline-ratings {
  margin: 10px 0;
}

/* On the paper page the three rating controls sit side by side on one
   row to keep the first panel short. Each cell stacks its label over
   the buttons so nothing wraps mid-row. The green tint marks the
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

.inline-ratings .rating-btn {
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

.inline-ratings-title {
  font-size: var(--fs-sm);
  font-variant: small-caps;
  letter-spacing: 0.04em;
  color: var(--ink-soft);
  margin-bottom: 8px;
}

/* ---------- Paper detail ---------- */

.back-btn {
  margin-bottom: 18px;
  border: none;
  background: none;
  color: var(--accent);
  padding: 0;
  font-size: var(--fs-md);
  box-shadow: none;
}

.back-btn:hover {
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
.icon-btn {
  padding: 4px;
  border: none;
  background: none;
  box-shadow: none;
  line-height: 0;
  color: var(--ink-faint);
  border-radius: var(--radius);
}

.icon-btn:hover:not(:disabled) {
  border: none;
  background: var(--paper);
  color: var(--ink);
}

/* A destructive icon states itself in red at rest, not only on hover. */
.icon-btn.danger-icon {
  color: var(--red);
}

.icon-btn.danger-icon:hover:not(:disabled) {
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
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 5px 16px 5px 6px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--card);
  text-decoration: none;
  color: var(--ink);
  margin: 6px 0 10px;
  transition: all 0.15s;
}

.nook-chip:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.nook-chip:hover .nook-chip-name {
  color: var(--accent);
}

.nook-chip-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--ink-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-md);
  flex-shrink: 0;
}

.nook-chip-name {
  display: block;
  font-size: var(--fs-md);
  line-height: 1.25;
}

.nook-chip-aff {
  display: block;
  font-size: var(--fs-xs);
  color: var(--ink-faint);
  line-height: 1.25;
}

.also-read {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 2px 0 10px;
}

.also-read-label {
  font-size: var(--fs-xs);
  font-variant: small-caps;
  letter-spacing: 0.04em;
  color: var(--ink-soft);
  margin-right: 4px;
}

.also-read .nook-chip {
  margin: 0;
  position: relative;
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

/* Title, state pill and reader chips read as one line about one paper.
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

/* The state pill and the reader chips are the same kind of thing here:
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

/* A nook row's readers. They answer to the whole row rather than to the
   title, so they sit at the row's right edge and centre against all of it,
   and they are drawn large: who else has this paper is the reason to look
   down someone's nook, and it should be legible at a glance rather than
   read one 22px circle at a time. */
.row-readers {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  margin-left: auto;
  /* clear of the switch in the corner above */
  padding-top: 10px;
}

.row-readers .mini-avatar {
  width: 34px;
  height: 34px;
  font-size: var(--fs-sm);
}

.row-readers .avatar-chip.mini {
  padding: 2px;
}

.avatar-chip.mini {
  padding: 1px;
}

.mini-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--ink-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-2xs);
  flex-shrink: 0;
}

.avatar-chip {
  position: relative;
  display: inline-flex;
  border-radius: 50%;
  padding: 2px;
  border: 1px solid var(--line-strong);
  background: var(--card);
  color: var(--ink);
  box-shadow: 0 1px 0 rgba(25, 35, 50, 0.12);
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}

/* A reader who wrote the paper. Authors are squared off while every
   other reader stays round, so the distinction survives without colour;
   gold is the app's "this person holds a role here" hue, as on the
   seminar leader's chip. */
.avatar-chip.author {
  border-radius: var(--radius);
  border-color: var(--gold);
  background: var(--gold-soft);
  box-shadow: 0 1px 0 rgba(25, 35, 50, 0.12);
}

/* Square the avatar inside to match the chip; the hover popup is the
   chip's other child and must keep its own shape. */
.avatar-chip.author > :not(.chip-pop) {
  border-radius: 1px;
}

.author-tag {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: var(--radius-pill);
  background: var(--gold-soft);
  border: 1px solid var(--gold-line);
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
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: 0 3px 10px rgba(25, 35, 50, 0.15);
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

.chip-pop-title {
  display: block;
  font-size: var(--fs-xs);
  font-variant: small-caps;
  letter-spacing: 0.04em;
  color: var(--ink-soft);
  margin-bottom: 6px;
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

.paper-actions .btn,
.paper-actions button {
  width: 7.5rem;
  text-align: center;
}

.paper-actions .btn {
  padding: 6px 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--card);
  text-decoration: none;
  color: var(--ink);
  font-size: var(--fs-xs);
  line-height: 1.5;
  box-shadow: 0 1px 0 rgba(25, 35, 50, 0.12);
}

/* Small buttons: these open the paper, they do not compete with the
   reader's own work below them. */
.paper-actions button {
  padding: 6px 12px;
  font-size: var(--fs-xs);
  line-height: 1.5;
}

/* The anchor equivalent of button.primary: reading the paper is the action
   this page exists for. */
.paper-actions .btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--ink-inverse);
}

.paper-actions .btn.primary:hover {
  background: var(--accent-strong);
  border-color: var(--accent-strong);
  color: var(--ink-inverse);
}

.paper-actions .btn:hover {
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
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-lg);
  background: var(--card);
  box-shadow: 0 12px 32px rgba(29, 33, 41, 0.18);
}

.paper-actions .share-menu > button,
.paper-actions .share-menu > a {
  display: block;
  width: 100%;
  padding: 9px 10px;
  border: none;
  box-shadow: none;
  text-align: left;
  background: transparent;
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

.canonical-share-menu label {
  display: block;
  margin: 2px 3px 6px;
  color: var(--ink-soft);
  font-size: var(--fs-xs);
  font-weight: 700;
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

.signed-out-reviews {
  margin-top: 18px;
  color: var(--ink-soft);
  font-size: var(--fs-sm);
}

/* ---------- Seminar / interest ---------- */

.discussion-card {
  background: var(--paper);
  border: 1px solid var(--line);
  border-left: 4px solid var(--accent);
  border-radius: var(--radius);
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

.seminar-head .head-pill {
  margin-left: auto;
}

.head-chips {
  margin-left: 4px;
}

.head-chips .chip-pop {
  left: 0;
  right: auto;
}

.seminar-head h4 {
  font-size: var(--fs-lg);
}

.seminar-head-meta {
  display: flex;
  align-items: center;
  gap: 8px;
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
  background: rgba(25, 35, 50, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.modal-box {
  width: 100%;
  max-width: 560px;
  max-height: 85vh;
  overflow-y: auto;
}

.modal-box .panel {
  margin-bottom: 0;
  box-shadow: 0 12px 40px rgba(25, 35, 50, 0.35);
}

h4 .state-pill {
  margin-left: 8px;
}

.interest-block {
  margin-bottom: 14px;
}

.interest-status, .interest-count-note {
  font-size: var(--fs-md);
  color: var(--ink-soft);
  margin: 8px 0;
}

.interest-list {
  list-style: none;
  margin: 8px 0 14px;
}

.interest-list li {
  padding: 8px 0;
  border-bottom: 1px dotted var(--line);
  font-size: var(--fs-base);
}

.interest-list li:last-child {
  border-bottom: none;
}

.interest-user {
  font-weight: 600;
}

.interest-date {
  color: var(--ink-faint);
  font-size: var(--fs-sm);
}

.interest-note {
  color: var(--ink-soft);
  font-style: italic;
  font-size: var(--fs-md);
}

.note-form {
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
     breaks are the reader's own structure — Markdown lists, headings — and
     reading-width leading spreads a short note over half the panel. */
  line-height: 1.4;
  background: var(--card);
  color: var(--ink);
  resize: vertical;
}

/* Sized by components/AutoTextarea.jsx as the reader types. Past a
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

.village-subtitle {
  color: var(--ink-soft);
  font-size: var(--fs-md);
  margin: -8px 0 14px;
}

.demo-intro h3 {
  margin-bottom: 12px;
}

.demo-intro p {
  margin-bottom: 12px;
}

.home-organize-item { padding: 8px 0; }
.home-organize-item + .home-organize-item { border-top: 1px solid var(--line); }
.home-organize-item strong { font-size: var(--fs-base); }
.home-organize-item p { margin-top: 2px; color: var(--ink-soft); font-size: var(--fs-sm); line-height: 1.55; }

.incubation-note {
  margin-top: 18px;
  font-size: var(--fs-sm);
  color: var(--ink-faint);
  font-style: italic;
}

/* The source link on the About page. A quiet mark, not a call to action:
   it sits below the note about incubation and is meant to be found by
   someone looking for it, not to compete with the demo button. */
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

.demo-cta-block {
  margin-top: 24px;
}

.demo-cta {
  padding: 15px 46px;
  font-size: var(--fs-xl);
  letter-spacing: 0.02em;
  border-radius: var(--radius);
  box-shadow: 0 3px 10px rgba(43, 74, 111, 0.3);
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.demo-cta:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 5px 14px rgba(43, 74, 111, 0.35);
}

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
  border: 1px solid var(--line);
  border-left-width: 3px;
  border-radius: var(--radius);
  padding: 12px 16px;
  margin: 12px 0;
  background: var(--card);
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

.collapse-btn {
  margin-left: 10px;
  padding: 0 8px;
  border: none;
  background: none;
  font-size: var(--fs-2xl);
  line-height: 1;
  vertical-align: middle;
  color: var(--ink-soft);
  box-shadow: none;
}

.collapse-btn:hover:not(:disabled) {
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
   the reader wrote, it is all structured configuration, which the type
   roles put in the interface font. Same reasoning as .announce-card above,
   over a whole page rather than one card — and the reason the page read as
   a jumble was that its chrome was borrowing the prose face and then
   distinguishing itself with italics, small-caps and five sizes instead.
   Two faces with one job each: serif says heading, sans says control. */
.profile-page,
.profile-page input,
.profile-page label,
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

/* An address the reader has to copy out exactly is an identifier, which
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
  display: inline-block;
  margin-left: 10px;
  padding: 1px 9px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
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

.seminar-card-date {
  font-size: var(--fs-xs);
  color: var(--ink-faint);
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

.seminar-meta {
  color: var(--ink-faint);
  font-size: var(--fs-sm);
  font-style: italic;
}

.availability-form {
  margin-top: 12px;
}

.availability-form label {
  display: block;
  font-size: var(--fs-sm);
  color: var(--ink-soft);
  margin-bottom: 4px;
}

.availability-form button {
  margin-top: 8px;
}

.availability-list ul {
  list-style: none;
}

.availability-list li {
  font-size: var(--fs-md);
  padding: 4px 0;
}

.announce-form {
  margin-top: 8px;
}

/* ---------- Rooms & inbox ---------- */

a.btn {
  display: inline-block;
  padding: 8px 18px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--card);
  color: var(--ink);
  text-decoration: none;
  font-size: var(--fs-md);
  box-shadow: 0 1px 0 rgba(25, 35, 50, 0.12);
}

a.btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}

.mini-title {
  font-size: var(--fs-sm);
  font-variant: small-caps;
  letter-spacing: 0.04em;
  color: var(--ink-soft);
  margin-bottom: 8px;
}

.room-kicker-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 2px;
}

.room-kicker {
  font-size: var(--fs-xs);
  font-variant: small-caps;
  letter-spacing: 0.08em;
  color: var(--ink-faint);
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
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 16px 18px;
  margin: 12px 0 16px;
  background: var(--card);
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
  color: var(--ink-faint);
  font-style: italic;
  margin-top: 6px;
}

.stage-action {
  margin-top: 10px;
}

.join-chip {
  border: none;
  border-radius: var(--radius-pill);
  padding: 6px 18px;
  font-size: var(--fs-base);
  font-weight: 600;
  color: var(--ink-inverse);
  background: var(--accent);
  box-shadow: 0 1px 3px rgba(25, 35, 50, 0.25);
}

.join-chip:hover:not(:disabled) {
  background: var(--accent);
  filter: brightness(0.93);
}

.participant-chip .chip-x {
  border: none;
  background: none;
  box-shadow: none;
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
  padding: 5px 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--card);
  font: inherit;
  color: inherit;
}

.room-hidden-note {
  background: var(--gold-soft);
  color: var(--gold-ink);
  border: 1px solid var(--gold-line);
  border-radius: var(--radius);
  padding: 10px 14px;
  font-size: var(--fs-md);
  margin: 12px 0;
}

.room-participants {
  margin-top: 14px;
}

.room-block {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}

.room-view .call-note {
  margin-top: 8px;
}

.participant-chips {
  display: flex;
  flex-wrap: wrap;
  /* Centred, not stretched. The chips and the Join button are not the same
     height — a reader chip carries an avatar and the button does not — and
     stretching lines up their tops, which is the one thing about them that
     should not have to agree. Worse, the button sits inside .hint-anchor,
     so stretching the anchor left the button itself at the anchor's top
     rather than the row's middle. */
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.participant-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px 4px 5px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--card);
  color: var(--ink);
  text-decoration: none;
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

/* A reader without a picture shows their initial on a colour of their
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
  margin-top: 10px;
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

.avail-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.avail-text {
  color: var(--ink);
}

.avail-none {
  color: var(--ink-faint);
  font-style: italic;
}

.avail-edit {
  display: flex;
  gap: 8px;
  align-items: stretch;
}

.avail-edit input {
  flex: 1;
  padding: 7px 11px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  font-size: var(--fs-md);
  font-family: inherit;
  background: var(--card);
  color: var(--ink);
}

.avail-edit input:focus {
  outline: none;
  border-color: var(--accent);
}

.avail-edit button {
  flex-shrink: 0;
  padding: 6px 16px;
}

.announce-card {
  margin: 12px 0 16px;
  border: 1px solid var(--line);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius);
  padding: 14px 16px;
  background: var(--card);
}

.announce-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 14px;
}

.room-messages {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.room-message {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.room-message-body {
  flex: 1;
  min-width: 0;
}

.room-message-meta {
  font-size: var(--fs-sm);
}

.room-message-time {
  color: var(--ink-faint);
  font-size: var(--fs-xs);
  margin-left: 8px;
  font-weight: normal;
}

.room-message-content {
  font-size: var(--fs-base);
  white-space: pre-wrap;
}

/* ---------- Home ---------- */

.home-hero {
  text-align: center;
  padding: 40px 28px 34px;
}

.home-fleuron {
  color: var(--accent);
  font-size: var(--fs-3xl);
  margin-bottom: 6px;
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

.home-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.home-card {
  display: block;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--card);
  padding: 18px 18px 16px;
  text-decoration: none;
  color: var(--ink);
  transition: border-color 0.15s, background 0.15s, transform 0.15s;
}

.home-card:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
  transform: translateY(-2px);
}

.home-card h3 {
  font-size: var(--fs-lg);
  margin-bottom: 4px;
}

.home-card:hover h3 {
  color: var(--accent);
}

.home-card p {
  font-size: var(--fs-sm);
  color: var(--ink-soft);
  line-height: 1.5;
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
  display: inline-block;
  background: var(--accent);
  color: var(--ink-inverse);
  border-radius: var(--radius-pill);
  font-size: var(--fs-2xs);
  font-family: var(--font-ui);
  padding: 1px 7px;
  margin-left: 6px;
  vertical-align: middle;
}

.notif-list {
  list-style: none;
}

.notif-item {
  padding: 12px 8px;
  border-bottom: 1px solid var(--line);
  cursor: pointer;
  transition: background 0.15s;
}

.notif-item:last-child {
  border-bottom: none;
}

.notif-item:hover {
  background: var(--accent-soft);
}

.notif-item.unread {
  background: var(--accent-soft);
  border-left: 3px solid var(--accent);
  padding-left: 9px;
}

.notif-item.unread .notif-content {
  font-weight: 600;
}

.notif-new {
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

.notif-content {
  font-size: var(--fs-base);
}

/* Collapsed: a single teaser line; clicking expands (and de-news) it */
.notif-content.collapsed {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.notif-room-link {
  margin-top: 4px;
  font-size: var(--fs-md);
}

.notif-date {
  font-size: var(--fs-xs);
  color: var(--ink-faint);
  margin-top: 2px;
}

/* ---------- Admin ---------- */

.active-user-count {
  margin: 2px 0 0;
  font-family: var(--font-ui);
  color: var(--ink-soft);
}

.active-user-count span {
  color: var(--green-ink);
  font-size: var(--fs-3xl);
  font-weight: 700;
}

.concurrency-title {
  margin-top: 18px;
}

.concurrency-chart-wrap {
  width: 100%;
  overflow-x: auto;
}

.concurrency-chart {
  display: block;
  width: 100%;
  min-width: 540px;
  height: auto;
  font: 11px var(--font-ui);
  color: var(--ink-faint);
}

.concurrency-chart line {
  stroke: var(--line);
  stroke-width: 1;
}

.concurrency-chart text {
  fill: currentColor;
}

.concurrency-area {
  fill: var(--green-soft);
}

.concurrency-line {
  fill: none;
  stroke: var(--green-ink);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.concurrency-chart:focus {
  outline: 2px solid var(--green-ink);
  outline-offset: 2px;
}

.concurrency-inspector {
  pointer-events: none;
}

.concurrency-inspector .concurrency-guide {
  stroke: var(--green-ink);
  stroke-dasharray: 3 3;
}

.concurrency-inspector circle {
  fill: var(--paper);
  stroke: var(--green-ink);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.concurrency-inspector rect {
  fill: var(--paper);
  stroke: var(--line-dark);
  stroke-width: 1;
  filter: drop-shadow(0 2px 4px rgb(0 0 0 / 0.14));
}

.concurrency-inspector text {
  fill: var(--ink-soft);
  font-size: 12px;
}

.concurrency-inspector .concurrency-tooltip-time {
  fill: var(--ink);
  font-weight: 700;
}

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

.inline-thought > .link-btn,
.summary-block > .link-btn {
  display: block;
  width: 100%;
  padding: 8px 12px;
  border-radius: var(--radius);
  text-align: left;
}

.inline-thought > .link-btn {
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

.summary-block > .link-btn {
  background: var(--accent-soft);
  color: var(--accent);
}

.paper-notes h4 {
  margin: 0 0 8px;
}

/* ---------- Markdown prose (summaries and notes) ---------- */

/* The reader's own prose, rendered by components/Markdown.jsx. It carries
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

.admin-row-actions .danger-link {
  margin: 0;
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

.comment {
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

.comment-date {
  color: var(--ink-faint);
}

.delete-comment-btn {
  padding: 2px 8px;
  font-size: var(--fs-xs);
  border: none;
  background: none;
  color: var(--ink-faint);
  box-shadow: none;
}

.delete-comment-btn:hover {
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

/* ---------- Responsive ---------- */

/* ---------- Boards inside My nook ---------- */

.nook-tabs {
  display: flex;
  gap: 20px;
  margin: 0 0 22px;
  border-bottom: 1px solid var(--line);
}

.nook-tabs button {
  padding: 8px 2px;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.nook-tabs button.active { color: var(--accent); border-bottom-color: var(--accent); }
.experimental-title { display: flex; align-items: center; gap: 9px; }
.experimental-badge { display: inline-flex; align-items: center; gap: 4px; width: max-content; padding: 2px 7px; border: 1px solid var(--gold-line); border-radius: var(--radius-pill); background: var(--gold-soft); color: var(--gold-ink); font: 600 var(--fs-2xs) var(--font-ui); letter-spacing: .03em; text-transform: uppercase; vertical-align: middle; white-space: nowrap; }
.experimental-badge svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 1.35; stroke-linecap: round; stroke-linejoin: round; }
.experimental-badge.compact { margin-left: 4px; padding: 2px 4px; }
.experimental-badge.compact svg { width: 11px; height: 11px; }
.boards-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.boards-heading { margin-bottom: 18px; }
.boards-heading h3 { font-size: var(--fs-xl); }
.board-create { margin-top: 12px; }
.board-list { display: grid; gap: 10px; }
.board-list-card { display: grid; gap: 4px; width: 100%; padding: 18px; text-align: left; background: var(--card); }
.board-list-card-board { position: relative; border: 1px solid var(--line); border-left: 5px solid var(--shelf-color); border-radius: var(--radius); box-shadow: 0 1px 4px rgba(29,33,41,.08); cursor: pointer; }
.board-list-card-board:hover, .board-list-card-board:focus-visible { border-color: var(--shelf-color); box-shadow: 0 4px 12px rgba(29,33,41,.13); outline: none; }
.board-list-title { font-size: var(--fs-lg); font-weight: 750; }
.board-list-card-board .board-list-description { font-weight: 550; }
.board-list-description { color: var(--ink-soft); white-space: pre-wrap; }
.board-list-meta { display: flex; justify-content: space-between; gap: 16px; color: var(--ink-faint); font-family: var(--font-ui); font-size: var(--fs-xs); }
.board-list-shelf { width: max-content; max-width: 220px; margin-top: 5px; padding: 4px 28px 4px 7px; font: var(--fs-xs) var(--font-ui); }
body.board-workspace-open { overflow: hidden; }
body.board-workspace-open .app { max-width: none; padding: 0; }
body.board-workspace-open .app > .topnav,
body.board-workspace-open .feedback-fab { display: none; }
body.board-workspace-open .main-content { display: block; padding: 0; }
.infinite-board { position: fixed; inset: 0; z-index: 100; overflow: hidden; background: var(--paper-sunken); font-family: var(--font-serif); }
.board-toolbar { position: absolute; z-index: 38; inset: 0 0 auto; min-height: 55px; display: flex; align-items: center; gap: 12px; padding: 10px 18px; border-bottom: 1px solid var(--line); background: var(--card); font-family: var(--font-ui); }
.board-toolbar button { padding: 6px 12px; border-radius: var(--radius); box-shadow: none; font-family: var(--font-ui); font-size: var(--fs-xs); line-height: 1.5; }
.board-toolbar .board-back { min-width: 0; overflow: hidden; border: 0; padding-left: 0; background: transparent; color: var(--accent); font-family: var(--font-serif); font-size: var(--fs-base); text-overflow: ellipsis; white-space: nowrap; }
.board-toolbar-title { min-width: 100px; max-width: 360px; border: 1px solid transparent; padding: 6px 8px; background: transparent; color: var(--ink); font: 600 var(--fs-lg) var(--font-serif); }
.board-toolbar-title:focus { outline: none; border-color: var(--accent-line); background: var(--paper); }
.board-toolbar-title[readonly] { cursor: default; }
.board-toolbar-title[readonly]:focus { border-color: transparent; background: transparent; }
.board-toolbar-edited { color: var(--ink-faint); font: var(--fs-2xs) var(--font-ui); white-space: nowrap; }
.board-readonly-badge { padding: 3px 7px; border: 1px solid var(--line-strong); border-radius: var(--radius-pill); color: var(--ink-soft); background: var(--paper); font: 600 var(--fs-2xs) var(--font-ui); text-transform: uppercase; letter-spacing: .04em; }
.board-toolbar-spacer { flex: 1; }
.board-toolbar .board-tidy-button { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line-strong); background: var(--card); color: var(--ink-soft); }
.board-toolbar .board-tidy-button:hover:not(:disabled), .board-toolbar .board-tidy-button:focus-visible { border-color: var(--accent); outline: none; background: var(--accent-soft); color: var(--accent); }
.board-tidy-glyph { width: 18px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.4; }
.board-actions-menu { position: relative; flex: none; }
.board-actions-menu summary { display: flex; align-items: center; justify-content: center; gap: 2px; width: 30px; height: 30px; border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--card); color: var(--ink-soft); cursor: pointer; list-style: none; }
.board-actions-menu summary::-webkit-details-marker { display: none; }
.board-actions-menu summary:hover, .board-actions-menu summary:focus-visible, .board-actions-menu[open] summary { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); outline: none; }
.board-actions-menu summary i { width: 3px; height: 3px; border-radius: 50%; background: currentColor; }
.board-actions-popover { position: absolute; z-index: 50; top: calc(100% + 5px); right: 0; min-width: 150px; padding: 4px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--card); box-shadow: 0 8px 20px rgba(29,33,41,.16); }
.board-toolbar .board-actions-popover button { width: 100%; border: 0; background: transparent; box-shadow: none; color: var(--red); text-align: left; }
.board-toolbar .board-actions-popover button:hover:not(:disabled), .board-toolbar .board-actions-popover button:focus-visible { background: var(--red-soft); color: var(--red); }
.board-card-count { color: var(--ink-faint); font: var(--fs-xs) var(--font-ui); white-space: nowrap; }
.board-card-count strong { color: var(--ink-soft); font-weight: 650; }
.board-viewport { position: absolute; inset: 55px 0 0; overflow: hidden; touch-action: none; cursor: default; background-color: var(--paper-sunken); background-image: radial-gradient(circle, var(--line-strong) var(--board-grid-dot), transparent var(--board-grid-dot)); background-position: var(--board-grid-x) var(--board-grid-y); background-size: var(--board-grid-size) var(--board-grid-size); }
.board-viewport:active { cursor: default; }
.board-viewport.file-dragging { background-color: var(--accent-soft); }
.board-marquee { position: absolute; z-index: 3; border: 1px solid var(--accent); background: rgba(43,74,111,.1); pointer-events: none; }
.board-selection-menu { position: fixed; z-index: 45; top: 64px; left: 50%; display: flex; align-items: center; gap: 10px; transform: translateX(-50%); padding: 5px 6px 5px 12px; border: 1px solid var(--accent-line); border-radius: var(--radius-pill); background: var(--card); box-shadow: 0 5px 16px rgba(29,33,41,.16); color: var(--ink-soft); font: var(--fs-xs) var(--font-ui); }
.board-selection-menu button { padding: 5px 10px; border: 0; border-radius: var(--radius-pill); background: var(--accent); color: white; box-shadow: none; font: 600 var(--fs-xs) var(--font-ui); }
.board-new-hint { position: fixed; z-index: 46; top: 66px; left: 50%; display: flex; align-items: center; gap: 12px; transform: translateX(-50%); max-width: min(520px, calc(100vw - 32px)); padding: 9px 10px 9px 14px; border: 1px solid var(--accent-line); border-radius: var(--radius); background: var(--card); box-shadow: 0 6px 18px rgba(29,33,41,.16); color: var(--ink-soft); font: var(--fs-sm) var(--font-ui); animation: board-hint-in .2s ease-out; }
.board-new-hint span { min-width: 0; }
.board-new-hint button { width: 24px; height: 24px; flex: none; padding: 0; border: 0; border-radius: 50%; background: transparent; box-shadow: none; color: var(--ink-faint); font: var(--fs-lg) var(--font-ui); line-height: 1; }
@keyframes board-hint-in { from { opacity: 0; transform: translate(-50%, -6px); } }
.board-drop-target { position: fixed; z-index: 4; inset: 75px 20px 20px; display: grid; place-items: center; border: 2px dashed var(--accent-line); border-radius: var(--radius); background: rgba(234,239,245,.72); color: var(--accent); font: var(--fs-base) var(--font-ui); pointer-events: none; }
.board-stage { position: absolute; left: 0; top: 0; width: 1px; height: 1px; transform-origin: 0 0; will-change: transform; }
.board-chapter { --chapter-line: #8d99a8; position: absolute; z-index: 0; left: 0; top: 0; width: 24px; pointer-events: none; transition: height 180ms cubic-bezier(.22,.9,.3,1); }
.board-chapter::before { content: ''; position: absolute; top: 74px; bottom: 18px; left: 10px; width: 2px; border-radius: 2px; background: var(--chapter-line); }
.board-chapter::after { content: ''; position: absolute; top: 74px; left: 10px; width: 12px; height: 2px; border-radius: 2px; background: var(--chapter-line); }
.board-chapter-spine { position: absolute; z-index: 3; top: 66px; bottom: 8px; left: 0; width: 22px; padding: 0; border: 0; border-radius: 8px; background: transparent; box-shadow: none; pointer-events: auto; cursor: grab; }
.board-chapter-spine:active { cursor: grabbing; }
.board-chapter-spine:hover:not(:disabled) { border: 0; background: color-mix(in srgb, var(--chapter-line) 9%, transparent); box-shadow: none; }
.board-chapter:has(.board-chapter-spine:hover), .board-chapter.selected { --chapter-line: var(--accent); }
.board-chapter.drop-active { --chapter-line: var(--accent); }
.board-chapter.drop-active::before { width: 3px; box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent) 12%, transparent); }
.board-chapter.drop-active .board-chapter-heading { border-bottom-color: var(--accent); }
.board-chapter.drop-active .board-chapter-title { color: var(--accent); }
.board-chapter.selected::before { width: 3px; box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 10%, transparent); }
.board-chapter.collection { box-sizing: border-box; pointer-events: auto; }
.board-chapter.collection::before { display: none; }
.board-chapter.collection::after { display: block; z-index: -1; top: 76px; right: 0; bottom: 0; left: 0; box-sizing: border-box; width: auto; height: auto; border: 1px dashed var(--line-strong); border-radius: 14px; background: transparent; }
.board-chapter.collection.moving-active::after, .board-chapter.collection.drop-active::after { border-color: var(--accent); background: color-mix(in srgb, var(--accent-soft) 55%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 10%, transparent); }
.board-chapter.collection.moving-active { transition: none; }
.board-chapter.collection.selected::after { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 10%, transparent); }
.board-chapter.collection .board-chapter-spine { z-index: 1; inset: 76px 0 0; width: auto; border-radius: 14px; background: rgba(0,0,0,.001); cursor: grab; touch-action: none; }
.board-chapter.collection:has(.board-chapter-spine:hover)::after { border-color: var(--accent-line); }
.board-chapter.collection:has(.board-chapter-spine:active)::after { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 10%, transparent); }
.board-chapter.collection .board-chapter-heading { top: 0; left: 12px; width: calc(100% - 24px) !important; height: 36px; }
.board-chapter.collection .board-chapter-header { top: 36px; left: 12px; width: calc(100% - 24px) !important; }
.board-chapter.collection .board-chapter-title { color: var(--ink-soft); font-family: var(--font-ui); font-size: var(--fs-sm); }
.board-chapter-heading { position: absolute; top: 0; left: 0; box-sizing: border-box; max-width: 420px; height: 36px; border-bottom: 1px solid var(--line-strong); pointer-events: none; }
.board-chapter-header { position: absolute; top: 36px; left: 0; box-sizing: border-box; max-width: 420px; height: 34px; pointer-events: none; }
.board-chapter-title { display: block; width: 100%; height: 35px; margin: 0; padding: 3px 5px; overflow: hidden; border: 1px solid transparent; border-radius: 6px 6px 0 0; background: transparent; box-shadow: none; color: var(--ink); font: 650 var(--fs-lg) var(--font-serif); text-align: left; text-overflow: ellipsis; white-space: nowrap; pointer-events: auto; }
.board-chapter-title:hover { border-color: var(--line-strong); background: color-mix(in srgb, var(--card) 88%, transparent); }
.board-chapter-title:focus { outline: 2px solid var(--accent-soft); border-color: var(--accent); background: var(--card); }
.board-chapter-title.empty { color: var(--ink-faint); font-style: italic; }
.board-chapter-header-text { display: block; width: 100%; height: 33px; margin: 0; padding: 6px 5px; overflow: hidden; resize: none; border: 1px solid transparent; border-radius: 0 0 6px 6px; background: transparent; box-shadow: none; color: var(--ink-soft); font: var(--fs-sm) var(--font-serif); line-height: 1.35; text-align: left; white-space: pre-wrap; pointer-events: auto; }
.board-chapter-header-text:hover { border-color: var(--line-strong); background: color-mix(in srgb, var(--card) 88%, transparent); }
.board-chapter-header-text:focus { outline: 2px solid var(--accent-soft); border-color: var(--accent); background: var(--card); }
.board-chapter-header-text.empty { color: var(--ink-faint); font-family: var(--font-ui); font-size: var(--fs-xs); font-style: italic; }
.board-chapter-branch { position: absolute; z-index: 4; left: 10px; height: 1px; border-radius: 1px; background: var(--chapter-line); pointer-events: auto; transition: transform 180ms cubic-bezier(.22,.9,.3,1); }
.board-chapter-branch::before { content: ''; position: absolute; inset: -15px 0; }
.board-chapter-reorder-handle { position: absolute; z-index: 4; left: -14px; top: -15px; display: grid; grid-template-columns: repeat(2, 3px); place-content: center; gap: 4px; width: 30px; height: 30px; padding: 0; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--card); box-shadow: 0 2px 6px rgba(29,33,41,.17); opacity: 0; pointer-events: auto; cursor: grab; transition: opacity .14s ease, transform .14s ease, box-shadow .14s ease, border-color .14s ease; }
.board-chapter-branch:hover .board-chapter-reorder-handle, .board-chapter-reorder-handle.card-hovered, .board-chapter-reorder-handle.card-selected, .board-chapter-reorder-handle:focus-visible { opacity: 1; }
.board-chapter-reorder-handle:hover { transform: scale(1.08); border-color: var(--accent); box-shadow: 0 3px 9px rgba(43,74,111,.2); }
.board-chapter-reorder-handle:active { cursor: grabbing; }
.board-chapter-reorder-handle i { width: 3px; height: 3px; border-radius: 50%; background: var(--ink-faint); }
.board-card-drag-handle { position: absolute; z-index: 4; top: -12px; left: -12px; display: block; width: 34px; height: 34px; padding: 0; border: 1px solid var(--line-strong); border-top: 4px solid var(--ink-faint); border-left: 4px solid var(--ink-faint); border-radius: 11px 4px 8px 4px; background-color: var(--card); background-image: radial-gradient(circle, var(--ink-faint) 1.5px, transparent 1.7px); background-position: 6px 6px; background-size: 7px 7px; box-shadow: 3px 4px 9px rgba(29,33,41,.22); opacity: 0; pointer-events: none; cursor: grab; transition: opacity .14s ease, transform .14s ease, box-shadow .14s ease, border-color .14s ease; }
.board-canvas-card:hover > .board-card-drag-handle, .board-card-drag-handle:hover, .board-card-drag-handle:focus-visible, .board-card-drag-handle:active { opacity: 1; pointer-events: auto; }
.board-card-drag-handle:hover, .board-card-drag-handle:focus-visible { border-color: var(--accent); outline: none; transform: scale(1.08); box-shadow: 0 3px 9px rgba(43,74,111,.2); }
.board-card-drag-handle:active { cursor: grabbing; }
.board-card-drag-handle i { display: none; }
.board-canvas-card.chapter-reorder-peer { z-index: 3; transition: transform 180ms cubic-bezier(.22,.9,.3,1), box-shadow 180ms ease, scale 180ms ease; }
.board-canvas-card.chapter-reordering { z-index: 5; scale: 1.025; transition: none; box-shadow: 0 16px 36px rgba(29,33,41,.22); cursor: grabbing; }
.board-canvas-card { position: absolute; left: 0; top: 0; width: 300px; max-height: 520px; overflow: visible; border: 1px solid var(--line-strong); border-radius: 10px; background: var(--card); box-shadow: 0 2px 5px rgba(29,33,41,.09), 0 9px 24px rgba(29,33,41,.08); cursor: default; user-select: none; contain: layout style; will-change: transform; }
.board-canvas-card.selected { z-index: 2; outline: 2px solid var(--accent); outline-offset: 3px; border-color: var(--accent-line); border-radius: 10px; box-shadow: 0 6px 20px rgba(43,74,111,.16); }
.board-canvas-card.selected > .board-card-header,
.board-canvas-card.selected > .board-card-content,
.board-canvas-card.selected > .board-item-menu { pointer-events: none; }
.board-card-header { display: flex; align-items: center; justify-content: space-between; min-height: 36px; padding: 5px 7px 5px 10px; border-bottom: 1px solid var(--line); border-radius: 9px 9px 0 0; background: color-mix(in srgb, var(--paper) 72%, var(--card)); }
.board-card-kind { display: inline-flex; align-items: center; gap: 7px; min-width: 0; color: var(--ink-faint); font: 650 var(--fs-2xs) var(--font-ui); letter-spacing: .045em; text-transform: uppercase; }
.board-card-kind i { display: grid; width: 17px; height: 17px; place-items: center; border: 1px solid var(--line-strong); border-radius: 5px; background: var(--card); color: var(--ink-soft); font-style: normal; font-size: 10px; line-height: 1; }
.board-card-more { width: 27px; height: 25px; padding: 0; border: 0; border-radius: 5px; background: transparent; box-shadow: none; color: var(--ink-faint); font: 600 10px var(--font-ui); letter-spacing: 1px; line-height: 1; }
.board-card-more:hover, .board-card-more:focus-visible, .board-card-more[aria-expanded="true"] { border: 0; outline: none; background: var(--accent-soft); color: var(--accent); box-shadow: none; }
.board-card-content { overflow: hidden; border-radius: 0 0 9px 9px; }
.board-canvas-card img { display: block; width: 100%; max-height: 380px; object-fit: contain; background: var(--paper); pointer-events: none; }
.board-image-loading { display: grid; width: 100%; aspect-ratio: 4 / 3; place-items: center; background: var(--paper); }
.board-canvas-card.youtube .board-image-loading, .board-canvas-card.webpage .board-image-loading { aspect-ratio: 16 / 9; }
.board-canvas-card.webpage img,
.board-canvas-card.youtube img { height: auto; max-height: none; object-fit: initial; background: transparent; }
.board-canvas-card p { margin: 0; padding: 14px; white-space: pre-wrap; user-select: text; cursor: text; }
.board-canvas-file { display: flex; align-items: center; gap: 10px; width: auto; margin: 0; padding: 16px 14px; overflow-wrap: anywhere; text-align: left; color: var(--accent); background: var(--card); font: var(--fs-sm) var(--font-ui); }
.board-canvas-file > span:first-child { display: grid; width: 28px; height: 28px; flex: none; place-items: center; border: 1px solid var(--accent-line); border-radius: 6px; background: var(--accent-soft); }
.board-item-menu { position: absolute; z-index: 3; left: calc(100% + 8px); top: 0; display: grid; min-width: 96px; padding: 3px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--card); box-shadow: 0 6px 18px rgba(29,33,41,.18); cursor: default; }
.board-item-menu button { border: 0; padding: 6px 9px; background: transparent; box-shadow: none; text-align: left; font: var(--fs-xs) var(--font-ui); white-space: nowrap; }
.board-item-menu button:hover { background: var(--accent-soft); }
.board-item-menu button.remove { color: var(--red); }
.board-resize-handle { position: absolute; z-index: 3; right: -7px; bottom: -7px; width: 14px; height: 14px; padding: 0; border: 1px solid var(--accent); border-radius: 50%; background: var(--card); box-shadow: 0 1px 3px rgba(29,33,41,.2); cursor: nwse-resize; }
.board-youtube-description { margin: 0; padding: 12px 14px; border-top: 1px solid var(--line); cursor: text; }
.board-editable-text { cursor: text; }
.board-youtube-description.empty { color: var(--ink-faint); font-family: var(--font-ui); font-size: var(--fs-xs); font-style: italic; }
.board-excerpt-source { display: block; margin: 0; padding: 10px 14px; border-top: 1px solid var(--line); color: var(--accent); background: var(--paper); font: var(--fs-xs) var(--font-ui); text-decoration: none; }
.board-excerpt-source:hover { text-decoration: underline; text-underline-offset: 2px; }
.board-excerpt-text { margin: 0; padding: 16px 16px 14px; border: 0; color: var(--ink); font: var(--fs-sm) var(--font-serif); line-height: 1.55; white-space: pre-wrap; user-select: text; }
.board-staging { position: absolute; z-index: 20; top: 18px; right: 18px; display: flex; flex-direction: column; width: min(310px, calc(100vw - 36px)); max-height: calc(100% - 36px); border: 1px solid var(--line-strong); border-radius: 8px; background: color-mix(in srgb, var(--card) 94%, transparent); box-shadow: 0 10px 30px rgba(29,33,41,.2); font-family: var(--font-ui); touch-action: auto; }
.board-staging > header { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
.board-staging > header strong { color: var(--ink); font-size: var(--fs-sm); }
.board-staging > header span { color: var(--ink-faint); font-size: var(--fs-2xs); }
.board-staging-list { display: grid; gap: 8px; padding: 9px; overflow: auto; }
.board-staging-card { padding: 10px; border: 1px solid #a991c2; border-radius: var(--radius); background: var(--card); box-shadow: 0 2px 7px rgba(29,33,41,.1); cursor: grab; user-select: none; }
.board-staging-card:active { cursor: grabbing; }
.board-staging-card p { display: -webkit-box; margin: 0 0 8px; overflow: hidden; color: var(--ink); font: var(--fs-sm) var(--font-serif); line-height: 1.45; -webkit-box-orient: vertical; -webkit-line-clamp: 4; }
.board-staging-card footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.board-staging-card a { min-width: 0; overflow: hidden; color: var(--accent); font-size: var(--fs-2xs); text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
.board-staging-card a:hover { text-decoration: underline; }
.board-staging-card button { flex: none; width: 24px; height: 24px; padding: 0; border: 0; background: transparent; box-shadow: none; color: var(--ink-faint); font-size: var(--fs-lg); line-height: 1; }
.board-inline-text-editor { width: 100%; margin-top: 8px; border: 1px solid var(--accent); border-radius: var(--radius); background: var(--card); overflow: hidden; }
.board-inline-description { display: block; width: 100%; margin: 0; padding: 7px; resize: vertical; border: 0; border-radius: 0; background: var(--card); color: var(--ink); font: var(--fs-sm) var(--font-serif); user-select: text; }
.board-inline-description:focus { outline: 2px solid var(--accent-soft); }
.board-inline-format { display: flex; gap: 2px; padding: 3px; border-bottom: 1px solid var(--line); background: var(--paper); }
.board-inline-format button { width: 27px; min-width: 27px; padding: 3px 5px; border: 0; background: transparent; box-shadow: none; color: var(--ink-soft); font-size: var(--fs-base); line-height: 1; }
.board-inline-format button:nth-child(1) { text-align: left; }
.board-inline-format button:nth-child(2) { text-align: center; }
.board-inline-format button:nth-child(3) { text-align: right; }
.board-inline-format button.active { background: var(--accent-soft); color: var(--accent); }
.board-align-glyph { display: block; width: 18px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; }
.board-youtube-loading { position: absolute; left: 0; top: 0; display: flex; align-items: center; justify-content: center; gap: 10px; width: 300px; min-height: 170px; border: 1px solid var(--line); border-radius: 2px; background: var(--card); color: var(--ink-soft); box-shadow: 0 1px 6px rgba(25,35,50,.18); user-select: none; touch-action: none; font: var(--fs-sm) var(--font-ui); will-change: transform; }
.board-loading-spinner { width: 17px; height: 17px; border: 2px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: board-spin .8s linear infinite; }
@keyframes board-spin { to { transform: rotate(360deg); } }
.board-canvas-error { position: fixed; z-index: 120; top: 68px; left: 50%; transform: translateX(-50%); padding: 8px 14px; background: var(--red-soft); color: var(--red); border: 1px solid var(--red-line); }

@media (prefers-reduced-motion: reduce) {
  .board-chapter,
  .board-chapter-branch,
  .board-chapter-reorder-handle,
  .board-canvas-card.chapter-reorder-peer { transition-duration: 0ms; }
}

@media (max-width: 700px) {
  .board-toolbar { gap: 6px; min-height: 55px; padding: 7px 10px; overflow: visible; }
  .board-toolbar .board-back { display: grid; flex: none; width: 40px; height: 40px; padding: 0; place-items: center; font-size: var(--fs-lg); }
  .board-toolbar .board-back span { display: none; }
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
  .board-item-menu { left: 0; top: calc(100% + 8px); min-width: 112px; width: 112px; scale: var(--board-ui-scale); transform-origin: top left; }
  .board-item-menu button { min-height: 40px; padding: 8px 12px; }
  .board-resize-handle { right: -14px; bottom: -14px; width: 28px; height: 28px; scale: var(--board-ui-scale); }
  .board-chapter-spine { left: calc(-6px * var(--board-ui-scale)); width: calc(32px * var(--board-ui-scale)); }
  .board-chapter-reorder-handle { left: -16px; top: -17px; width: 34px; height: 34px; scale: var(--board-ui-scale); }
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

  .topnav nav a {
    flex: 1;
    text-align: center;
    padding: 9px 0;
    font-family: var(--font-ui);
    font-size: var(--fs-sm);
  }

  .panel {
    padding: 16px;
  }

  .space-header { margin-bottom: 14px; }
  .space-header-row { display: grid; grid-template-columns: 48px minmax(0, 1fr); align-items: center; gap: 10px 14px; }
  .space-header-actions { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); align-items: stretch; width: 100%; margin-left: 0; }
  .space-header-actions .new-board-btn { width: 100%; min-width: 0; justify-content: center; padding-right: 10px; }
  .space-header-actions .upload-section.compact { width: 100%; min-width: 0; }
  .space-header-actions .upload-section.compact .dropzone { height: 100%; }
  .board-create-fields { grid-template-columns: 1fr; }

  .space > .paper-list { padding: 12px 10px; }
  .space .paper-browser { margin: -12px -10px 0; }
  .space .paper-browser-toggle { min-height: 44px; padding: 9px 12px; }
  .space .paper-search-tools { padding: 3px 12px 12px; }
  .space .paper-list li { gap: 8px; padding: 12px 8px 12px 24px; }
  .space .paper-item h4 { font-size: var(--fs-md); line-height: 1.28; }
  .space .paper-meta { margin-top: 3px; font-size: var(--fs-xs); line-height: 1.45; }
  .space .row-readers { max-width: 74px; gap: 4px; padding-top: 0; flex-wrap: wrap; justify-content: flex-end; }
  .space .row-readers .mini-avatar { width: 32px; height: 32px; }
  .space .rating-summary.compact { flex-wrap: nowrap; gap: 10px; margin-top: 8px; white-space: nowrap; }
  .space .rating-summary.compact .rating-item { gap: 4px; }
  .space .rating-summary.compact .rating-dots { display: none; }
  .space .rating-summary.compact .rating-number { display: inline; }

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
  .library-reader-filters { margin-inline: -2px; padding-inline: 2px; padding-bottom: 7px; }
  .reader-filter { min-height: 38px; padding: 5px 10px; }
  .reader-filter-avatar { width: 24px; height: 24px; }
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

  /* Rows wrap uniformly: the trailing element (paper status pill, reader
     affiliation) always sits on its own line instead of wrapping only
     when the title or name happens to be long */
  h4 .state-pill {
    display: block;
    width: fit-content;
    margin: 4px 0 2px;
  }

  .user-list li {
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }

  .user-list .user-meta {
    margin-left: 34px; /* aligned under the name, clear of the avatar */
  }

  .paper-title-row {
    flex-wrap: wrap; /* only here, and only so the chips below can wrap */
  }

  .paper-title-row .title-chips {
    flex-basis: 100%; /* reader chips get their own line in every row too */
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
`;

function parseRoute() {
  const rawPath = stripAppBase(window.location.pathname || '/');
  const demo = rawPath === '/demo' || rawPath.startsWith('/demo/');
  const path = demo
    ? rawPath === '/demo' ? '/' : rawPath.slice('/demo'.length)
    : rawPath;
  const routed = (route) => (demo ? { ...route, demo: true } : route);
  let match = path.match(/^\/u\/(\d+)\/boards\/?$/);
  if (match) return routed({ page: 'space', id: parseInt(match[1]), section: 'boards' });
  match = path.match(/^\/u\/(\d+)\/?$/);
  if (match) return routed({ page: 'space', id: parseInt(match[1]) });
  // Papers are addressed by DOI when they have one (DOIs contain slashes),
  // falling back to the numeric id.
  match = path.match(/^\/paper\/(.+)\/?$/);
  if (match) return routed({ page: 'paper', id: match[1] });
  match = path.match(/^\/room\/(\d+)\/?$/);
  if (match) return routed({ page: 'room', id: parseInt(match[1]) });
  if (path === '/profile') return routed({ page: 'profile' });
  if (path === '/join') return routed({ page: 'join' });
  if (path === '/about') return routed({ page: 'about' });
  if (path === '/signin') return routed({ page: 'signin' });
  if (path === '/library' || path === '/papers') return routed({ page: 'papers' });
  if (path === '/village' || path === '/readers') return routed({ page: 'papers' });
  if (path === '/inbox') return routed({ page: 'inbox' });
  if (path === '/admin') return routed({ page: 'admin' });
  return routed({ page: 'home' });
}

const demoPath = (path) => {
  if (path === '/') return '/demo';
  return path.startsWith('/') ? `/demo${path}` : path;
};

const SIGN_IN_PAGES = new Set([
  'space', 'papers', 'room', 'inbox', 'admin', 'profile',
]);

function navigate(path) {
  const destination = demoActive() && !['/signin', '/join'].includes(path)
    && !path.startsWith('/demo')
    ? demoPath(path)
    : path;
  // Don't push a history entry when already there; otherwise Back appears
  // to do nothing.
  const mountedDestination = appPath(destination);
  if (`${window.location.pathname}${window.location.search}` === mountedDestination) return;
  window.history.pushState(
    { ...(window.history.state || {}), papolNavigation: true },
    '',
    mountedDestination,
  );
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function openBoard(guid) {
  const path = demoActive() ? `/demo/boards/${guid}` : `/boards/${guid}`;
  window.sessionStorage.setItem(
    'papol.boardReturn',
    `${window.location.pathname}${window.location.search}`,
  );
  window.location.assign(appPath(path));
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [route, setRoute] = useState(parseRoute());
  const [unreadCount, setUnreadCount] = useState(0);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // The welcome modal greets every fresh demo visit. Returning from its
  // viewer is still the same visit, so consume the viewer's one-shot marker
  // rather than greeting the reader again after the full-page transition.
  const [demoIntroSeen, setDemoIntroSeen] = useState(() => {
    const returnedFromViewer = window.sessionStorage.getItem('papol.viewerReturn') === '1';
    window.sessionStorage.removeItem('papol.viewerReturn');
    return returnedFromViewer;
  });

  // State-machine precedence is deliberate: an explicit demo URL wins;
  // otherwise a real authenticated reader wins; guest is only the public
  // fallback when neither of those primary modes applies.
  const mode = route.demo ? 'demo' : user ? 'signed-in' : 'guest';

  const dismissDemoIntro = () => setDemoIntroSeen(true);

  const demoIntroVisible = mode === 'demo' && Boolean(user) && !demoIntroSeen;

  useEffect(() => {
    if (!demoIntroVisible) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setDemoIntroSeen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [demoIntroVisible]);

  useEffect(() => {
    const onRouteChange = async () => {
      const next = parseRoute();
      if (next.demo && !route.demo) {
        enterDemo();
        setUser(await getMe());
      } else if (!next.demo && route.demo) {
        exitDemo();
        if (getToken()) {
          try {
            setUser(await getMe());
          } catch {
            setToken(null);
            setUser(null);
          }
        } else {
          setUser(null);
        }
      }
      setRoute(next);
    };
    window.addEventListener('popstate', onRouteChange);
    return () => window.removeEventListener('popstate', onRouteChange);
  }, [route.demo]);

  useEffect(() => {
    // A canonical paper URL is public and real. Do not route a signed-out
    // recipient into the fictional demo before that paper is opened.
    const initialRoute = parseRoute();
    if (initialRoute.demo) {
      enterDemo();
      getMe().then(setUser).finally(() => setAuthChecked(true));
      return;
    }
    exitDemo();
    if (initialRoute.page === 'paper') {
      if (getToken()) {
        getMe().then(setUser).catch(() => setToken(null)).finally(() => setAuthChecked(true));
      } else {
        setAuthChecked(true);
      }
      return;
    }
    if (!getToken()) {
      setUser(null);
      setAuthChecked(true);
      return;
    }
    getMe()
      .then(setUser)
      .catch(async () => {
        // A stale session becomes an ordinary guest session. Demo is only
        // entered by a URL that explicitly contains /demo.
        setToken(null);
        setUser(null);
      })
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      return;
    }
    getNotifications()
      .then((d) => setUnreadCount(d.unread_count))
      .catch(() => {});
  }, [user, route]);

  useEffect(() => {
    if (!user || demoActive() || !getToken()) return;
    const checkIn = () => sendPresence().catch(() => {});
    checkIn();
    const timer = window.setInterval(checkIn, 60_000);
    return () => window.clearInterval(timer);
  }, [user]);

  const handleAuth = ({ token, user }) => {
    const requestedPage = new URLSearchParams(window.location.search).get('next');
    const currentPath = stripAppBase(window.location.pathname || '/');
    const candidate = requestedPage || currentPath;
    const returnTo = candidate.startsWith('/paper/') || candidate.startsWith('/boards/')
      ? candidate
      : '/';
    exitDemo();
    setToken(token);
    setUser(user);
    if (returnTo.startsWith('/boards/')) {
      window.location.replace(appPath(returnTo));
      return;
    }
    navigate(returnTo);
  };

  const handleBackToAccount = async () => {
    window.history.replaceState(null, '', appPath('/'));
    setRoute(parseRoute());
    exitDemo();
    try {
      setUser(await getMe());
    } catch {
      setToken(null);
      setUser(null);
    }
  };

  const handleDemo = () => {
    navigate('/demo');
  };

  const handleLogout = async () => {
    if (demoActive()) {
      // Leaving the demo is a navigation, not a state teardown — the demo
      // stays alive underneath so Back returns into it. Signing in for
      // real (handleAuth) is what actually ends the demo.
      if (
        !confirm(
          'This leaves the demo and takes you to the sign-in page of the ' +
            'real Papol. Continue?'
        )
      ) {
        return;
      }
      navigate('/signin');
      return;
    }
    try {
      await logout();
    } catch {
      // best effort
    }
    setToken(null);
    exitDemo();
    setUser(null);
    navigate('/');
  };

  if (!authChecked) {
    return (
      <>
        <style>{styles}</style>
        <div className="loading">Loading…</div>
      </>
    );
  }

  const goBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      navigate('/');
    }
  };

  const guestNeedsSignIn = mode === 'guest' && SIGN_IN_PAGES.has(route.page);

  return (
    <>
      <style>{styles}</style>
      {demoIntroVisible && (
        <div className="modal-overlay" onClick={dismissDemoIntro}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="panel demo-intro">
              <h3>Welcome to Papol</h3>
              <p>
                Papol is a place to keep the papers you read and call
                spontaneous seminars on them with other readers.
              </p>
              <p>
                You are looking at the demo: you play as SpongeBob among
                fictional readers. Everything happens in your browser and
                nothing is saved.
              </p>
              <p>
                Register an account to have your own nook 
                and keep your papers and notes.
              </p>
              <div className="form-actions">
                <button
                  className="primary"
                  onClick={() => {
                    dismissDemoIntro();
                    navigate('/join');
                  }}
                >
                  Register
                </button>
                <button
                  onClick={() => {
                    dismissDemoIntro();
                    navigate('/signin');
                  }}
                >
                  Sign in
                </button>
                <button onClick={dismissDemoIntro}>Explore the demo</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {user && demoActive() && (
        <div className="demo-banner">
          <span>
            Demo mode — everything here is fictional and happens in your
            browser. Nothing is saved.
          </span>
          {getToken() ? (
            <button className="demo-banner-btn" onClick={handleBackToAccount}>
              Back to my account
            </button>
          ) : (
            <span className="demo-banner-actions">
              <button
                className="demo-banner-btn"
                onClick={() => navigate('/join')}
              >
                Create a real account
              </button>
              <button
                className="link-btn demo-banner-link"
                onClick={() => navigate('/signin')}
              >
                Sign in
              </button>
            </span>
          )}
        </div>
      )}
      <button
        type="button"
        className="feedback-fab"
        onClick={() => setFeedbackOpen(true)}
        title="Report a bug or ask for a feature"
      >
        Feedback
      </button>
      {feedbackOpen && (
        <FeedbackDialog
          // A demo visitor with no real token is a stranger to the backend,
          // so the dialog asks them for an address to reply to.
          currentUser={getToken() ? user : null}
          onClose={() => setFeedbackOpen(false)}
        />
      )}
      <div
        className="app"
        onClickCapture={(event) => {
          const anchor = event.target.closest?.('a[href^="/"]');
          const href = anchor?.getAttribute('href');
          if (
            !href ||
            anchor.hasAttribute('download') ||
            anchor.hasAttribute('data-document') ||
            (anchor.target && anchor.target !== '_self')
          ) return;
          const destination = new URL(href, window.location.origin);
          if (destination.origin !== window.location.origin) return;
          const routePath = stripAppBase(destination.pathname);
          event.preventDefault();
          navigate(`${routePath}${destination.search}`);
        }}
      >
        <header className="topnav">
          <a className="brand" href={appPath('/')}>Papol</a>
          <nav>
            {user ? (
              <a
                href={appPath('/')}
                className={
                  route.page === 'home' || route.page === 'board' ||
                  (route.page === 'space' && route.id === user.id)
                    ? 'active'
                    : ''
                }
              >
                My nook
              </a>
            ) : (
              <a href={appPath('/')} className={route.page === 'home' ? 'active' : ''}>
                Home
              </a>
            )}
            <a href={appPath('/library')} className={route.page === 'papers' ? 'active' : ''}>
              Library
            </a>
            <a href={appPath('/about')} className={route.page === 'about' ? 'active' : ''}>
              About
            </a>
          </nav>
          <span className="spacer" />
          {user ? (
            <>
              <a
                href={appPath('/inbox')}
                className={
                  route.page === 'inbox' ? 'inbox-link active' : 'inbox-link'
                }
              >
                Inbox
                {unreadCount > 0 && (
                  <span className="inbox-badge">{unreadCount}</span>
                )}
              </a>
              <a
                className={route.page === 'profile' ? 'whoami whoami-link active' : 'whoami whoami-link'}
                href={appPath('/profile')}
                title="Edit profile"
              >
                <Avatar user={user} className="nav-avatar" />
                <span className="whoami-name">
                  {user.display_name.split(' ')[0]}
                </span>
              </a>
              {user.is_admin && (
                <a
                  href={appPath('/admin')}
                  className={
                    route.page === 'admin' ? 'inbox-link active' : 'inbox-link'
                  }
                >
                  Admin
                </a>
              )}
            </>
          ) : mode === 'guest' ? (
            <button className="primary" onClick={() => navigate('/signin')}>
              Sign in
            </button>
          ) : null}
        </header>

        {/* Keyed by world and identity: leaving or entering the demo, or
            changing real accounts, remounts every page so no nook or private
            paper state can survive an identity boundary. */}
        <main className="main-content" key={`${mode}:${user?.id ?? 'none'}`}>
          {guestNeedsSignIn ? (
            <AuthPage onAuth={handleAuth} initialMode="login" />
          ) : (
          <>
          {route.page === 'home' &&
            (user ? (
              <Space
                userId={user.id}
                currentUser={user}
                onSelectPaper={(id) => navigate(`/paper/${id}`)}
                onSelectBoard={openBoard}
              />
            ) : (
              <HomePage
                currentUser={user}
                onDemo={demoActive() ? undefined : handleDemo}
              />
            ))}
          {route.page === 'space' && (
            <Space
              userId={route.id}
              currentUser={user}
              onSelectPaper={(id) => navigate(`/paper/${id}`)}
              onSelectBoard={openBoard}
              initialSection={route.section}
              onBack={goBack}
            />
          )}
          {route.page === 'paper' && (
            <PaperDetail
              paperId={route.id}
              currentUser={user}
              onBack={goBack}
              hideBack={
                mode !== 'demo' &&
                !window.history.state?.papolNavigation
              }
              onSelectPaper={(id) => navigate(`/paper/${id}`)}
            />
          )}
          {route.page === 'papers' && (
            <PapersPage
              currentUser={user}
              onSelectPaper={(id) => navigate(`/paper/${id}`)}
              onSelectBoard={openBoard}
            />
          )}
          {route.page === 'room' && (
            <RoomPage roomId={route.id} currentUser={user} onBack={goBack} />
          )}
          {route.page === 'inbox' && (
            <InboxPage
              onOpenRoom={(id) => navigate(`/room/${id}`)}
              onUnread={setUnreadCount}
            />
          )}
          {route.page === 'admin' &&
            (user && user.is_admin ? (
              <AdminPage />
            ) : (
              <div className="panel">
                <p className="panel-note">Admin access only.</p>
              </div>
            ))}
          {route.page === 'about' && (
            <HomePage
              currentUser={user}
              onDemo={demoActive() ? undefined : handleDemo}
            />
          )}
          {route.page === 'join' && (
            <AuthPage onAuth={handleAuth} initialMode="register" />
          )}
          {route.page === 'signin' && (
            <AuthPage onAuth={handleAuth} initialMode="login" />
          )}
          {route.page === 'profile' &&
            (user ? (
              <ProfilePage
                user={user}
                onUserUpdated={setUser}
                onLogout={handleLogout}
              />
            ) : null)}
          </>
          )}
        </main>
      </div>
    </>
  );
}
