import React, { useState, useEffect } from 'react';
import { getMe, getToken, setToken, logout, getNotifications } from './api';
import AuthPage from './components/AuthPage';
import UserDirectory from './components/UserDirectory';
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

const styles = `
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

.feedback-fab:hover {
  color: var(--accent);
  border-color: var(--accent);
  box-shadow: 0 4px 16px rgba(25, 35, 50, 0.22);
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
.paper-side .hint-pop {
  left: auto;
  right: 0;
}

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
  align-items: center;
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

.paper-list li.unmarketed {
  background: var(--paper-sunken);
  border-left: 3px dashed var(--line);
  padding-left: 9px;
}

.paper-list li.unmarketed .paper-item h4,
.paper-list li.unmarketed .paper-meta,
.paper-list li.unmarketed .rating-summary {
  opacity: 0.65;
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

/* ---------- Paper list ---------- */

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
  padding: 14px 8px;
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

.paper-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  flex-shrink: 0;
  cursor: default;
}

.paper-list li:last-child {
  border-bottom: none;
}

.paper-item h4 {
  font-weight: 600;
}

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
  /* The readers gather at the row's end, in a column down the list beside
     the display toggles — who has a paper is a fact about the row, not
     about the title, and it should not sit at a different place in every
     row because the titles are different lengths. */
  margin-left: auto;
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

.nook-stats {
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
  color: var(--ink-soft);
  margin-top: 4px;
}

.nook-stats .stat {
  white-space: nowrap;
}

.paper-list .month-header {
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-faint);
  padding: 16px 0 4px;
  border-bottom: none;
  list-style: none;
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
  padding: 6px 12px;
  background: var(--green-soft);
  border-radius: var(--radius);
  font-size: var(--fs-md);
  white-space: pre-wrap;
}

/* Summary sits beside Notes as an equal: same heading level, and its
   text is carded like a note. */
.summary-block {
  margin-bottom: 14px;
}

.summary-text {
  padding: 6px 12px;
  background: var(--accent-soft);
  border-radius: var(--radius);
  font-size: var(--fs-md);
  white-space: pre-wrap;
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

@media (max-width: 560px) {
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
  const hash = window.location.hash || '#/';
  let match = hash.match(/^#\/u\/(\d+)$/);
  if (match) return { page: 'space', id: parseInt(match[1]) };
  // Papers are addressed by DOI when they have one (DOIs contain slashes),
  // falling back to the numeric id.
  match = hash.match(/^#\/paper\/(.+)$/);
  if (match) return { page: 'paper', id: match[1] };
  match = hash.match(/^#\/room\/(\d+)$/);
  if (match) return { page: 'room', id: parseInt(match[1]) };
  if (hash === '#/profile') return { page: 'profile' };
  if (hash === '#/join') return { page: 'join' };
  if (hash === '#/about') return { page: 'about' };
  if (hash === '#/signin') return { page: 'signin' };
  if (hash === '#/demo') return { page: 'demo-entry' };
  if (hash === '#/library' || hash === '#/papers') return { page: 'papers' };
  if (hash === '#/village' || hash === '#/readers') return { page: 'directory' };
  if (hash === '#/inbox') return { page: 'inbox' };
  if (hash === '#/admin') return { page: 'admin' };
  return { page: 'home' };
}

function navigate(hash) {
  // Don't push a history entry when we're already there ('' and '#/' both
  // render home) — otherwise Back appears to do nothing.
  if ((window.location.hash || '#/') === hash) return;
  window.location.hash = hash;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [route, setRoute] = useState(parseRoute());
  const [unreadCount, setUnreadCount] = useState(0);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // The welcome modal greets every visit until the visitor signs in for
  // real — dismissing it only lasts for the current page load.
  const [demoIntroSeen, setDemoIntroSeen] = useState(false);

  const dismissDemoIntro = () => setDemoIntroSeen(true);

  const demoIntroVisible = Boolean(user) && demoActive() && !demoIntroSeen;

  useEffect(() => {
    if (!demoIntroVisible) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setDemoIntroSeen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [demoIntroVisible]);

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (demoActive()) {
      getMe()
        .then(setUser)
        .finally(() => setAuthChecked(true));
      return;
    }
    if (!getToken()) {
      // A visitor without an account is not met by a login wall: they
      // land straight in the demo, greeted by the welcome message.
      // #/signin and #/join still reach the auth page from inside the
      // demo shell.
      (async () => {
        enterDemo();
        setUser(await getMe());
        setAuthChecked(true);
      })();
      return;
    }
    getMe()
      .then(setUser)
      .catch(async () => {
        // Stale or revoked token: fall back to the demo landing.
        setToken(null);
        enterDemo();
        setUser(await getMe());
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

  const handleAuth = ({ token, user }) => {
    exitDemo();
    setToken(token);
    setUser(user);
    navigate('#/');
  };

  const handleBackToAccount = async () => {
    exitDemo();
    try {
      setUser(await getMe());
    } catch {
      setToken(null);
      setUser(null);
    }
    navigate('#/');
  };

  const handleDemo = async () => {
    enterDemo();
    setUser(await getMe());
    navigate('#/');
  };

  // #/demo is the demo's front door — a shareable link that drops the
  // visitor straight into demo mode, then lands on the demo home page
  // (replacing the entry so Back doesn't re-enter the demo).
  useEffect(() => {
    if (route.page !== 'demo-entry') return;
    (async () => {
      enterDemo();
      setUser(await getMe());
      setAuthChecked(true);
      window.location.replace('#/');
    })();
  }, [route]);

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
      navigate('#/signin');
      return;
    }
    try {
      await logout();
    } catch {
      // best effort
    }
    setToken(null);
    // Signed out means not logged in, and not logged in means the demo
    // landing — same as a fresh visit, welcome message included.
    enterDemo();
    setDemoIntroSeen(false);
    setUser(await getMe());
    navigate('#/');
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
      navigate('#/');
    }
  };

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
                    navigate('#/join');
                  }}
                >
                  Register
                </button>
                <button
                  onClick={() => {
                    dismissDemoIntro();
                    navigate('#/signin');
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
                onClick={() => navigate('#/join')}
              >
                Create a real account
              </button>
              <button
                className="link-btn demo-banner-link"
                onClick={() => navigate('#/signin')}
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
      <div className="app">
        <header className="topnav">
          <a className="brand" href="#/">Papol</a>
          <nav>
            {user ? (
              <a
                href="#/"
                className={
                  route.page === 'home' ||
                  (route.page === 'space' && route.id === user.id)
                    ? 'active'
                    : ''
                }
              >
                My nook
              </a>
            ) : (
              <a href="#/" className={route.page === 'home' ? 'active' : ''}>
                Home
              </a>
            )}
            <a href="#/village" className={route.page === 'directory' ? 'active' : ''}>
              Village
            </a>
            <a href="#/library" className={route.page === 'papers' ? 'active' : ''}>
              Library
            </a>
            <a href="#/about" className={route.page === 'about' ? 'active' : ''}>
              About
            </a>
          </nav>
          <span className="spacer" />
          {user ? (
            <>
              <a
                href="#/inbox"
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
                href="#/profile"
                title="Edit profile"
              >
                <Avatar user={user} className="nav-avatar" />
                <span className="whoami-name">
                  {user.display_name.split(' ')[0]}
                </span>
              </a>
              {user.is_admin && (
                <a
                  href="#/admin"
                  className={
                    route.page === 'admin' ? 'inbox-link active' : 'inbox-link'
                  }
                >
                  Admin
                </a>
              )}
            </>
          ) : null}
        </header>

        {/* Keyed by world: leaving or entering the demo remounts every
            page so nothing keeps showing data from the other world. */}
        <main className="main-content" key={demoActive() ? 'demo' : 'real'}>
          {route.page === 'home' &&
            (user ? (
              <Space
                userId={user.id}
                currentUser={user}
                onSelectPaper={(id) => navigate(`#/paper/${id}`)}
              />
            ) : (
              <HomePage
                currentUser={user}
                onDemo={demoActive() ? undefined : handleDemo}
              />
            ))}
          {route.page === 'directory' && (
            <UserDirectory
              currentUser={user}
              onVisit={(id) => navigate(`#/u/${id}`)}
            />
          )}
          {route.page === 'space' && (
            <Space
              userId={route.id}
              currentUser={user}
              onSelectPaper={(id) => navigate(`#/paper/${id}`)}
              onBack={goBack}
            />
          )}
          {route.page === 'paper' && (
            <PaperDetail
              paperId={route.id}
              currentUser={user}
              onBack={goBack}
              onSelectPaper={(id) => navigate(`#/paper/${id}`)}
            />
          )}
          {route.page === 'papers' && (
            <PapersPage
              currentUser={user}
              onSelectPaper={(id) => navigate(`#/paper/${id}`)}
            />
          )}
          {route.page === 'room' && (
            <RoomPage roomId={route.id} currentUser={user} onBack={goBack} />
          )}
          {route.page === 'inbox' && (
            <InboxPage
              onOpenRoom={(id) => navigate(`#/room/${id}`)}
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
          {route.page === 'demo-entry' && (
            <div className="loading">Entering the demo…</div>
          )}
          {route.page === 'profile' &&
            (user ? (
              <ProfilePage
                user={user}
                onUserUpdated={setUser}
                onLogout={handleLogout}
              />
            ) : null)}
        </main>
      </div>
    </>
  );
}
