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

const styles = `
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

:root {
  --ink: #1d2129;
  --ink-soft: #4d5561;
  --ink-faint: #7e8794;
  --paper: #f5f6f8;
  --card: #ffffff;
  --line: #dde2e8;
  --accent: #2b4a6f;
  --accent-soft: #eaeff5;
}

body {
  font-family: Georgia, 'Iowan Old Style', 'Times New Roman', serif;
  background: var(--paper);
  color: var(--ink);
  line-height: 1.65;
}

h1, h2, h3, h4, h5, h6 {
  font-weight: 600;
  line-height: 1.3;
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
  font-size: 1.5rem;
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
  font-size: 0.95rem;
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
  font-size: 0.95rem;
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

.demo-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 8px 16px;
  background: #faf3e3;
  color: #7a5b1e;
  border-bottom: 1px solid #e8d9b5;
  font-family: -apple-system, 'Segoe UI', sans-serif;
  font-size: 0.88rem;
}

.demo-banner-btn {
  border: 1px solid #7a5b1e;
  border-radius: 999px;
  background: transparent;
  color: #7a5b1e;
  padding: 3px 14px;
  font-size: 0.85rem;
  box-shadow: none;
}

.demo-banner-btn:hover {
  background: #7a5b1e;
  color: #fff;
}

.demo-banner-link {
  color: #7a5b1e;
  font-size: 0.85rem;
  text-decoration: underline;
}

.demo-invite {
  margin-top: 14px;
  padding: 10px 14px;
  border: 1px dashed var(--line);
  border-radius: 3px;
  font-size: 0.92rem;
  color: var(--ink-soft);
}

.demo-invite p {
  margin: 0;
}

.topnav .spacer {
  flex: 1;
}

.topnav .whoami {
  color: var(--ink-faint);
  font-size: 0.9rem;
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
  color: #fff;
  /* inline so the profile link keeps its text baseline (aligning with the
     rest of the row) while the avatar hangs centered beside the name */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  vertical-align: middle;
  font-size: 0.78rem;
  margin-right: 7px;
}

/* ---------- Generic ---------- */

.panel {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 3px;
  padding: 24px;
  margin-bottom: 20px;
}

.panel-title {
  font-size: 1.2rem;
  margin-bottom: 14px;
}

.main-content {
  display: grid;
  /* minmax(0, …) so a wide child (long nowrap text, etc.) can't blow the
     track past the viewport on narrow screens */
  grid-template-columns: minmax(0, 1fr);
  gap: 20px;
}

button {
  padding: 8px 18px;
  border: 1px solid #b4becb;
  border-radius: 3px;
  background: var(--card);
  color: var(--ink);
  cursor: pointer;
  font-size: 0.92rem;
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
  color: #fff;
}

button.primary:hover:not(:disabled) {
  background: #1e3752;
  color: #fff;
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
  background: #f9ecea;
  color: #8c2f22;
  border: 1px solid #e5c4bd;
  padding: 10px 14px;
  border-radius: 3px;
  margin-bottom: 16px;
  font-size: 0.92rem;
}

.warning {
  background: #faf3e3;
  color: #7a5b1e;
  border: 1px solid #e8d9b5;
  padding: 10px 14px;
  border-radius: 3px;
  margin-bottom: 16px;
  font-size: 0.92rem;
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
  background: #faf3e3;
  color: #7a5b1e;
  border: 1px solid #e8d9b5;
  border-radius: 3px;
  box-shadow: 0 3px 10px rgba(25, 35, 50, 0.15);
  padding: 8px 12px;
  font-size: 0.85rem;
  line-height: 1.5;
}

/* Popups anchored at a row's right edge open leftward to stay in view */
.paper-side .hint-pop {
  left: auto;
  right: 0;
}

.success {
  background: #edf3ea;
  color: #3d5c34;
  border: 1px solid #c9d9c1;
  padding: 10px 14px;
  border-radius: 3px;
  margin-bottom: 16px;
  font-size: 0.92rem;
}

.profile-email {
  color: var(--ink-soft);
  font-size: 0.92rem;
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
  font-size: 0.88rem;
  color: var(--ink-soft);
  font-variant: small-caps;
  letter-spacing: 0.04em;
}

.form-group input,
.form-group textarea,
.comment-form textarea,
.note-form textarea,
.availability-form textarea {
  width: 100%;
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: 3px;
  font-size: 0.98rem;
  font-family: inherit;
  background: #fcfdfe;
  color: var(--ink);
}

.form-group input:focus,
.form-group textarea:focus,
.comment-form textarea:focus,
.note-form textarea:focus,
.availability-form textarea:focus {
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

.checkbox-label {
  display: flex !important;
  align-items: center;
  gap: 8px;
  font-variant: normal !important;
  letter-spacing: normal !important;
  font-size: 0.95rem !important;
  color: var(--ink) !important;
  cursor: pointer;
}

.checkbox-label input[type="checkbox"] {
  width: auto;
  accent-color: var(--accent);
  cursor: pointer;
}

.market-status {
  font-size: 0.9rem;
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
  border-radius: 999px;
  line-height: 0;
}

.switch-text {
  font-size: 0.6rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  line-height: 1;
  white-space: nowrap;
}

.market-toggle.on .switch-text {
  color: #fff;
}

.market-toggle.off .switch-text {
  color: #5a6675;
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
  border-radius: 999px;
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
  background: #ccd4dd;
}

.market-toggle.off:hover .switch {
  background: #b8c2cf;
}

.switch-knob {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: 50%;
  background: #fff;
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
  background: #f1f3f6;
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
  border-radius: 3px;
  padding: 32px 28px;
  width: 100%;
  max-width: 400px;
}

.auth-card h2 {
  margin-bottom: 6px;
}

.auth-subtitle {
  color: var(--ink-soft);
  font-size: 0.92rem;
  font-style: italic;
  margin-bottom: 20px;
}

.auth-switch {
  margin-top: 18px;
  font-size: 0.92rem;
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
  font-size: 1.05rem;
}

.you-tag {
  color: var(--ink-faint);
  font-size: 0.85rem;
  font-style: italic;
}

.user-meta {
  color: var(--ink-faint);
  font-size: 0.88rem;
}

/* ---------- Space ---------- */

.space-header {
  margin-bottom: 20px;
}

.space-header h2 {
  font-size: 1.4rem;
}

.space-subtitle {
  color: var(--ink-faint);
  font-size: 0.9rem;
  font-style: italic;
}

/* ---------- Upload ---------- */

.dropzone {
  border: 1px dashed var(--ink-faint);
  border-radius: 3px;
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
  font-size: 0.85rem;
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
  font-family: -apple-system, 'Segoe UI', sans-serif;
  font-size: 0.85rem;
  color: var(--ink-soft);
  white-space: nowrap;
}

.sort-control select {
  padding: 7px 8px;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: var(--card);
  font: inherit;
  color: inherit;
}

.search-bar input {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--line);
  border-radius: 3px;
  font-size: 0.98rem;
  font-family: inherit;
  background: #fcfdfe;
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
  font-size: 0.88rem;
  color: var(--ink-soft);
  font-style: italic;
}

.interest-tag {
  font-size: 0.85rem;
  color: var(--accent);
  margin-top: 4px;
}

.paper-host {
  font-size: 0.85rem;
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
  font-size: 0.82rem;
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
  border-radius: 3px;
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
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  flex-shrink: 0;
}

.entry-name {
  font-size: 0.92rem;
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
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
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
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  flex-shrink: 0;
}

.avatar-buttons {
  display: flex;
  align-items: center;
  gap: 12px;
}

.avatar-hint {
  font-size: 0.8rem;
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
  color: #8c2f22;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 3px;
  font-size: 0.9rem;
  margin-right: auto;
}

.danger-link:hover {
  border: none;
  background: none;
  color: #8c2f22;
  text-decoration-style: solid;
}

.danger-link.remove-paper {
  margin-left: auto;
  margin-right: 0;
  align-self: center;
}

.summary-edit {
  margin-left: 10px;
  font-size: 0.8rem;
}

.add-summary {
  margin: 10px 0;
  font-size: 0.92rem;
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
  font-size: 0.82rem;
  color: var(--ink-soft);
  font-variant: small-caps;
  letter-spacing: 0.04em;
}

.rating-dots {
  letter-spacing: 2px;
  font-size: 0.72rem;
  color: var(--accent);
}

.rating-dots .dot:not(.filled) {
  color: var(--ink-faint);
}

.rating-none {
  color: var(--ink-faint);
  font-style: italic;
  font-size: 0.85rem;
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
  padding: 0;
  font-size: 0.8rem;
  color: var(--ink-faint);
}

.rating-clear:hover {
  border: none;
  background: none;
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 3px;
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
  font-size: 0.9rem;
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
  font-size: 0.85rem;
}

.rating-btn.selected {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.rating-btn.none {
  border-style: dashed;
  color: var(--ink-faint);
}

.rating-btn.none.selected {
  background: var(--ink-soft);
  border-color: var(--ink-soft);
  border-style: solid;
  color: #fff;
}

.rating-hint {
  font-size: 0.8rem;
  color: var(--ink-faint);
  font-style: italic;
  margin-top: 2px;
}

.visibility-badge {
  display: inline-block;
  font-size: 0.68rem;
  font-family: -apple-system, 'Segoe UI', sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 1px 8px;
  border-radius: 10px;
  border: 1px solid;
  margin-left: 8px;
  vertical-align: middle;
  font-style: normal;
  font-weight: 500;
}

.visibility-badge.public {
  color: #3d5c34;
  border-color: #c9d9c1;
  background: #edf3ea;
}

.visibility-badge.private {
  color: var(--accent);
  border-color: #c3cedd;
  background: var(--accent-soft);
}

.inline-ratings {
  margin: 14px 0;
}

.inline-ratings-title {
  font-size: 0.88rem;
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
  font-size: 0.92rem;
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
  font-size: 1.4rem;
  margin-bottom: 6px;
  /* clear the absolutely-positioned display toggle (~90px wide) */
  padding-right: 96px;
}

.detail-toggle {
  position: absolute;
  top: 0;
  right: 0;
}

.paper-info .authors {
  color: var(--ink-soft);
  margin-bottom: 8px;
  font-style: italic;
}

.metadata {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 8px;
}

.metadata span, .metadata a {
  font-size: 0.9rem;
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
  border-radius: 999px;
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
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  flex-shrink: 0;
}

.nook-chip-name {
  display: block;
  font-size: 0.92rem;
  line-height: 1.25;
}

.nook-chip-aff {
  display: block;
  font-size: 0.78rem;
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
  font-size: 0.82rem;
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

.paper-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.paper-title-row h4 {
  min-width: 0;
}

.title-chips {
  display: flex;
  gap: 4px;
}

.avatar-chip.mini {
  padding: 1px;
}

.mini-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.68rem;
  flex-shrink: 0;
}

.avatar-chip {
  position: relative;
  display: inline-flex;
  border-radius: 50%;
  padding: 2px;
  border: 1px solid #b4becb;
  background: var(--card);
  box-shadow: 0 1px 0 rgba(25, 35, 50, 0.12);
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
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
  font-size: 0.92rem;
}

.chip-pop-aff {
  display: block;
  font-size: 0.8rem;
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
  border-radius: 3px;
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
  font-size: 0.78rem;
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
  margin: 14px 0;
  padding: 14px 16px;
  background: var(--accent-soft);
  border-radius: 3px;
}

.summary h4 {
  margin-bottom: 6px;
  font-size: 0.88rem;
  font-variant: small-caps;
  letter-spacing: 0.04em;
  color: var(--ink-soft);
}

.summary p {
  color: var(--ink);
  font-size: 0.95rem;
  white-space: pre-wrap;
}

.paper-actions {
  display: flex;
  gap: 10px;
  margin: 18px 0 4px;
}

.paper-actions .btn {
  padding: 8px 18px;
  border: 1px solid #b4becb;
  border-radius: 3px;
  background: var(--card);
  text-decoration: none;
  color: var(--ink);
  font-size: 0.92rem;
  box-shadow: 0 1px 0 rgba(25, 35, 50, 0.12);
}

.paper-actions .btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}

/* ---------- Seminar / interest ---------- */

.discussion-card {
  background: #f3f6f9;
  border: 1px solid #d9e0e8;
  border-left: 4px solid var(--accent);
  border-radius: 3px;
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
  font-size: 1.05rem;
}

.seminar-head-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* The one seminar-state chip, used identically everywhere */
.state-pill {
  display: inline-block;
  font-size: 0.72rem;
  font-family: -apple-system, 'Segoe UI', sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 500;
  padding: 2px 10px;
  border-radius: 999px;
  vertical-align: middle;
}

.state-pill.called {
  background: var(--accent);
  color: #fff;
}

.state-pill.planning {
  background: #b3923d;
  color: #fff;
}

.state-pill.scheduled {
  background: #7ba26c;
  color: #fff;
}

.state-pill.finished {
  background: #8a94a2;
  color: #fff;
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
  color: #fff;
}

button.state-pill.planning,
button.state-pill.planning:hover:not(:disabled) {
  background: #b3923d;
  color: #fff;
}

button.state-pill.scheduled,
button.state-pill.scheduled:hover:not(:disabled) {
  background: #7ba26c;
  color: #fff;
}

button.state-pill.finished,
button.state-pill.finished:hover:not(:disabled) {
  background: #8a94a2;
  color: #fff;
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
  font-size: 0.92rem;
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
  font-size: 0.95rem;
}

.interest-list li:last-child {
  border-bottom: none;
}

.interest-user {
  font-weight: 600;
}

.interest-date {
  color: var(--ink-faint);
  font-size: 0.85rem;
}

.interest-note {
  color: var(--ink-soft);
  font-style: italic;
  font-size: 0.9rem;
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
  border-radius: 3px;
  font: inherit;
  font-size: 0.95rem;
  background: #fcfdfe;
  color: var(--ink);
  resize: vertical;
}

.inline-edit-actions {
  display: flex;
  gap: 8px;
}

.chip-pop-thought {
  display: block;
  font-style: italic;
  font-size: 0.85rem;
  margin-top: 3px;
  color: var(--ink-soft);
}

.village-subtitle {
  color: var(--ink-soft);
  font-size: 0.92rem;
  margin: -8px 0 14px;
}

.demo-cta {
  margin-top: 16px;
  padding: 11px 30px;
  font-size: 1.02rem;
}

.comment-actions {
  display: inline-flex;
  gap: 12px;
}

.nook-stats {
  font-family: -apple-system, 'Segoe UI', sans-serif;
  font-size: 0.85rem;
  color: var(--ink-soft);
  margin-top: 4px;
}

.nook-stats .stat {
  white-space: nowrap;
}

.paper-list .month-header {
  font-family: -apple-system, 'Segoe UI', sans-serif;
  font-size: 0.78rem;
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
  font-size: 0.85rem;
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
  border-radius: 3px;
  padding: 12px 16px;
  margin: 12px 0;
  background: var(--card);
}

.seminar-card.open {
  border-left-color: var(--accent);
}

.seminar-card.planning {
  border-left-color: #b3923d;
}

.seminar-card.scheduled {
  border-color: #c9d9c1;
  border-left-color: #7ba26c;
  background: #f6faf4;
}

.seminar-card.finished {
  border-left-color: #8a94a2;
  background: #f0f2f4;
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
  background: #f0f2f4;
}

.collapsed-meta {
  color: var(--ink-faint);
  font-size: 0.88rem;
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
  padding: 2px 12px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--card);
  font-family: -apple-system, 'Segoe UI', sans-serif;
  font-size: 0.78rem;
  color: var(--ink-soft);
  box-shadow: none;
}

.collapse-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--card);
}

/* The announce/edit form is UI, not prose — use the interface font */
.announce-card,
.announce-card input,
.announce-card label {
  font-family: -apple-system, 'Segoe UI', sans-serif;
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
  border-radius: 3px;
  font: inherit;
  font-size: 0.88rem;
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
  border-radius: 3px;
  cursor: pointer;
  font-family: -apple-system, 'Segoe UI', sans-serif;
  font-size: 0.88rem;
}

.style-option.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.style-option .style-desc {
  display: block;
  color: var(--ink-soft);
  font-size: 0.84rem;
}

.style-tag {
  display: inline-block;
  margin-left: 10px;
  padding: 1px 9px;
  border: 1px solid var(--line);
  border-radius: 999px;
  font-family: -apple-system, 'Segoe UI', sans-serif;
  font-size: 0.78rem;
  color: var(--ink-soft);
  background: var(--card);
  vertical-align: middle;
}

.stage-style {
  font-family: -apple-system, 'Segoe UI', sans-serif;
  font-size: 0.88rem;
  margin-top: 6px;
}

.seminar-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.seminar-card-date {
  font-size: 0.78rem;
  color: var(--ink-faint);
}

.seminar-person {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 0.95rem;
  margin: 4px 0;
}

.seminar-when {
  font-size: 1.02rem;
  margin: 4px 0;
}

.seminar-where {
  color: var(--ink-soft);
}

.seminar-card h6 {
  font-size: 0.85rem;
  font-variant: small-caps;
  letter-spacing: 0.04em;
  color: var(--ink-soft);
  margin: 14px 0 6px;
}

.seminar-meta {
  color: var(--ink-faint);
  font-size: 0.88rem;
  font-style: italic;
}

.availability-form {
  margin-top: 12px;
}

.availability-form label {
  display: block;
  font-size: 0.88rem;
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
  font-size: 0.92rem;
  padding: 4px 0;
}

.announce-form {
  margin-top: 8px;
}

/* ---------- Rooms & inbox ---------- */

a.btn {
  display: inline-block;
  padding: 8px 18px;
  border: 1px solid #b4becb;
  border-radius: 3px;
  background: var(--card);
  color: var(--ink);
  text-decoration: none;
  font-size: 0.92rem;
  box-shadow: 0 1px 0 rgba(25, 35, 50, 0.12);
}

a.btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}

.mini-title {
  font-size: 0.85rem;
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
  font-size: 0.8rem;
  font-variant: small-caps;
  letter-spacing: 0.08em;
  color: var(--ink-faint);
}


.room-title {
  font-size: 1.3rem;
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
  border-radius: 3px;
  padding: 16px 18px;
  margin: 12px 0 16px;
  background: var(--card);
}

.stage-card h5 {
  font-size: 1.02rem;
  margin-bottom: 4px;
}

.stage-card.open {
  background: var(--accent-soft);
  border-left: 4px solid var(--accent);
}

.stage-card.planning {
  background: #faf3e0;
  border-left: 4px solid #d4b662;
}

.stage-card.scheduled {
  background: #f6faf4;
  border-left: 4px solid #7ba26c;
  border-color: #c9d9c1;
}

.stage-card.finished {
  background: #f0f2f4;
  border-left: 4px solid #8a94a2;
}

.stage-when {
  font-size: 1.15rem;
  font-weight: 600;
  margin-top: 4px;
}

.stage-where {
  color: var(--ink-soft);
}

.stage-hint {
  font-size: 0.88rem;
  color: var(--ink-faint);
  font-style: italic;
  margin-top: 6px;
}

.stage-action {
  margin-top: 10px;
}

.join-chip {
  border: none;
  border-radius: 999px;
  padding: 6px 18px;
  font-size: 0.95rem;
  font-weight: 600;
  color: #fff;
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
  font-size: 1rem;
  color: var(--ink-faint);
  cursor: pointer;
}

.participant-chip .chip-x:hover:not(:disabled) {
  color: #a04c38;
  background: none;
}

.leave-handoff {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 10px;
  font-size: 0.92rem;
}

.leave-handoff select {
  padding: 5px 8px;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: var(--card);
  font: inherit;
  color: inherit;
}

.room-hidden-note {
  background: #faf3e3;
  color: #7a5b1e;
  border: 1px solid #e8d9b5;
  border-radius: 3px;
  padding: 10px 14px;
  font-size: 0.92rem;
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
  gap: 8px;
  margin-bottom: 10px;
}

.participant-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px 4px 5px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--card);
  color: var(--ink);
  text-decoration: none;
  font-size: 0.9rem;
}

.participant-chip:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.participant-chip.leader {
  background: #faf3e0;
  border-color: #d4b662;
  color: var(--ink);
}

.participant-chip.leader:hover {
  border-color: #b3923d;
  color: var(--ink);
}

.participant-chip.leader .entry-avatar {
  background: #b3923d;
  color: #fff;
}

.leader-star {
  color: #b3923d;
  font-size: 0.8rem;
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
  font-size: 0.92rem;
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
  border-radius: 3px;
  font-size: 0.92rem;
  font-family: inherit;
  background: #fcfdfe;
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
  border-radius: 3px;
  padding: 14px 16px;
  background: #fcfdfe;
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
  font-size: 0.85rem;
}

.room-message-time {
  color: var(--ink-faint);
  font-size: 0.78rem;
  margin-left: 8px;
  font-weight: normal;
}

.room-message-content {
  font-size: 0.96rem;
  white-space: pre-wrap;
}

/* ---------- Home ---------- */

.home-hero {
  text-align: center;
  padding: 40px 28px 34px;
}

.home-fleuron {
  color: var(--accent);
  font-size: 1.5rem;
  margin-bottom: 6px;
}

.home-title {
  font-size: 2.1rem;
  letter-spacing: 0.04em;
  margin-bottom: 2px;
}

.home-subtitle {
  font-variant: small-caps;
  letter-spacing: 0.18em;
  color: var(--ink-soft);
  font-size: 0.95rem;
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
  border-radius: 3px;
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
  font-size: 1.05rem;
  margin-bottom: 4px;
}

.home-card:hover h3 {
  color: var(--accent);
}

.home-card p {
  font-size: 0.85rem;
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
  font-size: 0.85rem;
  background: var(--card);
  border: 1px solid #b4becb;
  color: var(--ink-soft);
  flex-shrink: 0;
  position: relative;
  z-index: 1;
}

.flow-dot.live {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.flow-dot.gold {
  background: #b3923d;
  border-color: #b3923d;
  color: #fff;
}

.flow-dot.done {
  background: #7ba26c;
  border-color: #7ba26c;
  color: #fff;
}

.flow-body {
  flex: 1;
  min-width: 0;
  padding-top: 3px;
}

.flow-step-title {
  font-weight: 600;
  font-size: 0.98rem;
}

.flow-step-desc {
  font-size: 0.88rem;
  color: var(--ink-soft);
  margin-top: 2px;
  line-height: 1.55;
}

.inbox-badge {
  display: inline-block;
  background: var(--accent);
  color: #fff;
  border-radius: 999px;
  font-size: 0.7rem;
  font-family: -apple-system, 'Segoe UI', sans-serif;
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
  background: #edf2f8;
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
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font-family: -apple-system, 'Segoe UI', sans-serif;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  vertical-align: middle;
}

.notif-content {
  font-size: 0.95rem;
}

/* Collapsed: a single teaser line; clicking expands (and de-news) it */
.notif-content.collapsed {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.notif-room-link {
  margin-top: 4px;
  font-size: 0.9rem;
}

.notif-date {
  font-size: 0.8rem;
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
  font-size: 0.82rem;
  font-family: -apple-system, 'Segoe UI', sans-serif;
  border-radius: 999px;
}

.admin-tab.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.admin-table-wrap {
  overflow-x: auto;
  margin-top: 8px;
}

.admin-table {
  border-collapse: collapse;
  font-size: 0.82rem;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
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
  border-radius: 2px;
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
  background: #fcfdfe;
}

.admin-pk {
  color: var(--ink-faint);
  padding: 0 6px;
}

.admin-row-actions {
  white-space: nowrap;
}

.admin-row-actions button {
  padding: 3px 10px;
  font-size: 0.78rem;
  margin-right: 6px;
}

.admin-row-actions .danger-link {
  margin: 0;
  font-size: 0.78rem;
}

.admin-sql {
  width: 100%;
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: 3px;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 0.85rem;
  background: #fcfdfe;
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

.comment-form {
  margin-bottom: 20px;
}

.comment-form textarea {
  resize: vertical;
  margin-bottom: 8px;
}

.comments-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.comment {
  padding: 12px 14px;
  background: var(--accent-soft);
  border-radius: 3px;
}

.comment-content {
  margin-bottom: 6px;
  white-space: pre-wrap;
  font-size: 0.96rem;
}

.comment-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.85rem;
}

.comment-date {
  color: var(--ink-faint);
}

.delete-comment-btn {
  padding: 2px 8px;
  font-size: 0.8rem;
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

.no-comments, .guest-note {
  color: var(--ink-faint);
  font-style: italic;
}

.guest-note {
  margin-bottom: 16px;
  font-size: 0.92rem;
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
    font-family: -apple-system, 'Segoe UI', sans-serif;
    font-size: 0.85rem;
  }

  .panel {
    padding: 16px;
  }

  /* Back button gets its own row above the auth card instead of being
     squeezed into the sliver beside it */
  .auth-page {
    flex-wrap: wrap;
  }

  .auth-page .back-btn {
    flex-basis: 100%;
    text-align: left;
    margin-bottom: 4px;
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

const GUEST_KEY = 'papol_guest';

export default function App() {
  const [user, setUser] = useState(null);
  const [guest, setGuest] = useState(() => localStorage.getItem(GUEST_KEY) === '1');
  const [authChecked, setAuthChecked] = useState(false);
  const [route, setRoute] = useState(parseRoute());
  const [unreadCount, setUnreadCount] = useState(0);
  const [authStart, setAuthStart] = useState('login');

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
      setAuthChecked(true);
      return;
    }
    getMe()
      .then(setUser)
      .catch(() => setToken(null))
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
    setGuest(false);
    localStorage.removeItem(GUEST_KEY);
    navigate('#/');
  };

  const handleGuest = () => {
    setGuest(true);
    localStorage.setItem(GUEST_KEY, '1');
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
    setGuest(false);
    localStorage.removeItem(GUEST_KEY);
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
      setGuest(false);
      localStorage.removeItem(GUEST_KEY);
      setUser(await getMe());
      setAuthChecked(true);
      window.location.replace('#/');
    })();
  }, [route]);

  const handleSignIn = () => {
    setGuest(false);
    localStorage.removeItem(GUEST_KEY);
  };

  const handleLogout = async () => {
    if (demoActive()) {
      // Leaving the demo is a navigation, not a state teardown — the demo
      // stays alive underneath so Back returns into it. Signing in for
      // real (handleAuth) is what actually ends the demo.
      navigate('#/signin');
      return;
    }
    try {
      await logout();
    } catch {
      // best effort
    }
    setToken(null);
    setUser(null);
  };

  if (!authChecked) {
    return (
      <>
        <style>{styles}</style>
        <div className="loading">Loading…</div>
      </>
    );
  }

  if (!user && !guest) {
    return (
      <>
        <style>{styles}</style>
        <div className="app">
          <header className="topnav">
            <a className="brand" href="#/">Papol</a>
          </header>
          <AuthPage
            onAuth={handleAuth}
            onGuest={handleGuest}
            onDemo={handleDemo}
            initialMode={authStart}
          />
        </div>
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
      {user && demoActive() && (
        <div className="demo-banner">
          <span>
            Demo mode — everything here is make-believe and happens in your
            browser. Nothing is saved.
          </span>
          {getToken() ? (
            <button className="demo-banner-btn" onClick={handleBackToAccount}>
              Back to my account
            </button>
          ) : (
            <>
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
            </>
          )}
        </div>
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
          ) : (
            <>
              <span className="whoami">browsing as guest</span>
              <button className="link-btn" onClick={handleSignIn}>
                Sign in
              </button>
            </>
          )}
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
                onJoin={handleSignIn}
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
          {route.page === 'room' &&
            (user ? (
              <RoomPage roomId={route.id} currentUser={user} onBack={goBack} />
            ) : (
              <div className="panel">
                <p className="guest-note">Sign in to join seminar cohorts.</p>
              </div>
            ))}
          {route.page === 'inbox' &&
            (user ? (
              <InboxPage
                onOpenRoom={(id) => navigate(`#/room/${id}`)}
                onUnread={setUnreadCount}
              />
            ) : (
              <div className="panel">
                <p className="guest-note">Sign in to see your inbox.</p>
              </div>
            ))}
          {route.page === 'admin' &&
            (user && user.is_admin ? (
              <AdminPage />
            ) : (
              <div className="panel">
                <p className="guest-note">Admin access only.</p>
              </div>
            ))}
          {route.page === 'about' && (
            <HomePage
              currentUser={user}
              onJoin={handleSignIn}
              onDemo={demoActive() ? undefined : handleDemo}
            />
          )}
          {route.page === 'join' && (
            <AuthPage onAuth={handleAuth} initialMode="register" onBack={goBack} />
          )}
          {route.page === 'signin' && (
            <AuthPage onAuth={handleAuth} initialMode="login" onBack={goBack} />
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
            ) : (
              <div className="panel">
                <p className="guest-note">Sign in to edit your profile.</p>
              </div>
            ))}
        </main>
      </div>
    </>
  );
}
