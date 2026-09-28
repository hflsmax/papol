import { commonStyles } from './commonStyles.js';
import { desktopStyles } from './desktopStyles.js';
import { designTokens } from './designTokens.js';
import { itemActionsStyles } from './itemActionsStyles.js';
import { compatibilityStyles } from './compatibilityStyles.js';
import { macHandoffStyles } from './macHandoffStyles.js';
import { talkStyles } from './talkStyles.js';

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

/* ---------- The way bar ----------
   A signed-in member's one bar on the web: Papol and its three places (or,
   deeper, the trail back), then the inbox and the member. Small UI type on
   one row with no rule under it, so the page's own title leads. */

.way-bar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-height: 32px;
  margin: 0 0 var(--space-5);
  font: var(--fs-sm) var(--font-ui);
}

.way {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  flex: 1;
  min-width: 0;
  color: var(--ink-faint);
}

.way a,
.way-aside a {
  color: var(--ink-soft);
  text-decoration: none;
  white-space: nowrap;
}

.way a:hover,
.way-aside a:hover { color: var(--accent); }

.way a.way-mark {
  color: var(--ink);
  font: 600 var(--fs-md) var(--font-serif);
  letter-spacing: .02em;
}

/* Beside the trail home: everyone else's papers, boards and projects, and
   the inbox, as quiet as the trail. */
.way-aside {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.way-aside a { display: inline-flex; align-items: center; color: var(--ink-faint); }
.way-aside a[aria-current] { color: var(--ink); }

/* The trail: each step after Papol follows a chevron; the last may be
   long (a project, a paper) and gives way before the bar wraps. */
.way-trail {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}
.way-trail:empty,
#way-slot:not(:empty) + .way-default { display: none; }
.way-trail a { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.way-trail a::before { content: '›'; margin-right: var(--space-2); color: var(--ink-faint); }

.way-count {
  display: inline-block;
  min-width: 18px;
  margin-left: 5px;
  padding: 0 5px;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--ink-inverse);
  font: 600 var(--fs-2xs)/18px var(--font-ui);
  text-align: center;
}

.way-self { position: relative; display: inline-flex; border-radius: 50%; }
.way-self-count { position: absolute; top: -5px; right: -9px; margin: 0; box-shadow: 0 0 0 2px var(--paper); }

/* A member's own page: who they are, then Inbox, Activity or Account,
   one at a time, in the tabs a project's desk uses. */
.you-head { display: flex; align-items: center; gap: var(--space-4); margin-bottom: var(--space-4); }
.you-avatar { width: 56px; height: 56px; font-size: var(--fs-xl); }
.you-name { margin: 0; font: 600 var(--fs-2xl) var(--font-serif); }
.you-affiliation { margin: 2px 0 0; color: var(--ink-soft); font-style: italic; }
.you-tabs { margin-bottom: var(--space-4); }
.you-who { flex: 1; min-width: 0; }
.inbox-panel.is-bare .panel-head-row:empty { display: none; }
.inbox-panel.is-bare .panel-head-row { justify-content: flex-end; margin-bottom: var(--space-2); }
.inbox-panel.is-bare .panel-head-row .link-button { font: var(--fs-sm) var(--font-ui); }
.way-self .nav-avatar { margin: 0; vertical-align: 0; }
.way-self[aria-current] .nav-avatar { box-shadow: 0 0 0 2px var(--paper), 0 0 0 3px var(--ink-soft); }

@media (max-width: 640px) {
  .way-bar { gap: var(--space-3); }
  .way-aside { gap: var(--space-3); }
}

/* About, Learn and the Mac app, for a member: at the foot of the page.
   The page is at least the window tall, so a short page leaves the foot on
   the window's bottom edge and a long one carries it down after its end.
   Its line sits level with the feedback button, and the foot itself keeps
   that button off the page's last line. */
.app.has-way:not(.is-project) {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
  padding-bottom: 0;
}
.app.has-way:not(.is-project) > .main-content { padding-bottom: 0; }
.way-foot {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0 var(--space-4);
  margin-top: auto;
  padding: var(--space-7) 0 20px;
  font: var(--fs-sm)/30px var(--font-ui);
}
/* On a phone the centred links would run into the button; they start
   from the left edge and leave it the right. */
@media (max-width: 640px) { .way-foot { justify-content: flex-start; } }
.way-foot a { color: var(--ink-faint); text-decoration: none; }
.way-foot a:hover { color: var(--accent); }

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

.admin-email-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

.sent-email-subject {
  font-weight: 600;
  text-align: left;
}

.sent-email-detail {
  margin-top: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--card);
}

/* An HTML email is drawn on the white its sender assumed. */
.sent-email-html {
  display: block;
  width: 100%;
  min-height: 360px;
  border: 0;
  background: #fff;
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

${compatibilityStyles}

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

.upload-review-mode > .back-button,
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

/* A folder from an agent (FolderImport): the prompt to hand over, then
   the folder's review, one quiet row per paper. */
.dropzone .add-folder { white-space: nowrap; }
.dropzone .add-folder-link { font-family: inherit; line-height: inherit; vertical-align: baseline; }
.folder-agent-hint { margin: 10px 0 0; font-size: var(--fs-sm); color: var(--ink-soft); }
.folder-agent-hint summary { cursor: pointer; }
.folder-agent-hint .folder-import-instructions { margin: 8px 0 0; }
.folder-import h3 { margin: 0; }
.folder-import-lede { margin: 8px 0 14px; color: var(--ink-soft); }
.folder-import-instructions {
  margin: 0 0 16px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--paper-sunken);
  font: var(--fs-sm)/1.5 var(--font-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.folder-rows { list-style: none; margin: 14px 0; padding: 0; border-top: 1px solid var(--line); }
.folder-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid var(--line);
}
.folder-row > input[type='checkbox'] { margin-top: 5px; accent-color: var(--accent); }
.folder-row.left-out .folder-row-body { opacity: .55; }
.folder-row-body { display: grid; gap: 2px; min-width: 0; }
.folder-row-title { font-family: var(--font-serif); font-size: var(--fs-md); color: var(--ink); }
input.folder-row-title { width: 100%; padding: 2px 4px; margin-left: -5px; border: 1px solid transparent; border-radius: var(--radius); background: transparent; }
input.folder-row-title:hover, input.folder-row-title:focus { border-color: var(--line); background: var(--card); }
.folder-row-meta { color: var(--ink-faint); font: var(--fs-xs) var(--font-ui); overflow-wrap: anywhere; }
.folder-row-note { color: var(--ink-soft); font-size: var(--fs-sm); font-style: italic; }
.folder-row-known { margin-top: 2px; font: var(--fs-xs) var(--font-ui); color: var(--ink-soft); }
.folder-row-status { color: var(--ink-faint); font: var(--fs-xs) var(--font-ui); white-space: nowrap; text-align: right; padding-top: 4px; }
.folder-row-status.trouble { color: var(--red); white-space: normal; max-width: 180px; }
@media (max-width: 640px) {
  .folder-row { grid-template-columns: auto minmax(0, 1fr); }
  .folder-row-status { grid-column: 2; text-align: left; padding-top: 0; }
}

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
.paper-tags.vis-public .tag-editor-card { background: var(--vis-soft); }
.paper-tags.vis-public .tag-editor { border-color: var(--vis-line); }
.paper-tags.vis-public .tag-editor:focus-within { border-color: var(--green); box-shadow: 0 0 0 1px var(--green); }
.paper-tags.vis-public .tag-editor .tag-chip { border-color: var(--vis-line); color: var(--vis-ink); }
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

/* On a paper's jacket the chip beside a copy's field is also its switch.
   It stays a badge to look at; the pointer and the ring on hover and focus
   are what say it can be pressed. */
.visibility-toggle {
  line-height: inherit;
  box-shadow: none;
  cursor: pointer;
}

/* The once-only card saying a copy's parts can each be private or public,
   hung from the first chip. It sits in a kicker heading, so it puts back
   plain text. */
.visibility-lesson-anchor { position: relative; display: inline-block; }
.learn-papol {
  position: absolute;
  z-index: 42;
  top: calc(100% + 12px);
  /* Centred on the chip, which sits 8px into the anchor. */
  left: calc(50% + 4px);
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  width: min(270px, calc(100vw - 24px));
  padding: 14px 16px;
  border-color: var(--accent);
  color: var(--ink-soft);
  font: var(--fs-sm) / 1.4 var(--font-ui);
  font-variant: normal;
  letter-spacing: normal;
  text-transform: none;
  text-align: left;
}
.learn-papol::before {
  content: '';
  position: absolute;
  left: calc(50% - 6px);
  top: -7px;
  width: 12px;
  height: 12px;
  border-top: 1px solid var(--accent);
  border-left: 1px solid var(--accent);
  background: var(--card);
  transform: rotate(45deg);
}
.learn-papol strong { color: var(--ink); font-size: var(--fs-md); }
.learn-papol .learn-papol-kicker { color: var(--accent); font-variant: small-caps; letter-spacing: 0.04em; }
.learn-papol .learn-papol-close {
  align-self: flex-end;
  margin-top: 2px;
  padding: 4px 9px;
  border-color: var(--accent);
  background: var(--accent);
  color: var(--ink-inverse);
}

/* Keeps its own colours on hover, where every other button turns blue:
   a public chip that went blue would be saying private. */
.visibility-toggle.public:hover:not(:disabled),
.visibility-toggle.public:focus-visible {
  color: var(--green-ink);
  background: var(--green-soft);
  border-color: currentColor;
  box-shadow: 0 0 0 1px currentColor;
}

.visibility-toggle.private:hover:not(:disabled),
.visibility-toggle.private:focus-visible {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: currentColor;
  box-shadow: 0 0 0 1px currentColor;
}

/* A field's tint follows its chip: green where others see it, blue where
   only its user does. The blocks below read these, and fall back to what
   the field was before it had a say. */
.vis-public {
  --vis-soft: var(--green-soft);
  --vis-line: var(--green-line);
  --vis-ink: var(--green-ink);
}

.vis-private {
  --vis-soft: var(--accent-soft);
  --vis-line: var(--accent-line);
  --vis-ink: var(--accent);
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
   the buttons so nothing wraps mid-row. The tint says who sees them
   (.vis-public, .vis-private). */
.inline-ratings .rating-inputs {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px 18px;
  padding: 8px 12px;
  background: var(--vis-soft, var(--green-soft));
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

/* ---------- A board's jacket ---------- */

/* Set like a paper's — the same panel, title row, shelf picker, trash and
   action row — because the two are the same kind of thing. What is its own
   is below: the name and description edited in place, the facts line, the
   preview, and the lists of papers and waiting clips. */
.board-jacket-heading {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 12px;
}

.board-jacket-heading h2 {
  flex: 0 1 auto;
  min-width: 0;
  margin: 0;
  font-size: var(--fs-2xl);
  overflow-wrap: anywhere;
}

/* The owner's name and description are the words themselves, and pointing
   at them says they can be changed. */
.board-jacket-editable {
  cursor: text;
  border-radius: var(--radius);
  outline: none;
  transition: background-color var(--motion-fast) var(--ease-out),
    box-shadow var(--motion-fast) var(--ease-out);
}

.board-jacket-editable:hover,
.board-jacket-editable:focus-visible {
  background: var(--accent-soft);
  box-shadow: 0 0 0 4px var(--accent-soft);
}

.board-jacket-name-input {
  flex: 1 1 16rem;
  min-width: 0;
  margin: -5px 0 -4px;
  padding: 3px 7px;
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  background: var(--card);
  font-size: var(--fs-2xl);
  font-weight: 600;
  line-height: 1.3;
}

.board-jacket-name-input:focus { outline: none; box-shadow: 0 0 0 2px var(--accent-soft); }

/* One muted line, the parts set apart by middots. */
.board-jacket-facts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  margin: 2px 0 0;
  color: var(--ink-faint);
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  line-height: 1.8;
  /* Every part carries its middot in front, and the line is drawn one
     middot's width to the left with that width clipped away: whichever part
     starts a line, on a phone too, starts it without a stray dot. */
  margin-left: -16px;
  clip-path: inset(0 0 0 16px);
}

.board-jacket-facts > *::before {
  content: '·';
  display: inline-block;
  width: 16px;
  color: var(--line-strong);
  text-align: center;
}

.board-jacket-owner {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-soft);
  text-decoration: none;
}

.board-jacket-owner::before { margin-right: -6px; }
.board-jacket-owner:hover { color: var(--accent); }
.board-jacket-owner .mini-avatar { width: 20px; height: 20px; }

.board-jacket-description {
  max-width: 44rem;
  margin: 12px 0 0;
  color: var(--ink-soft);
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.board-jacket-description.board-jacket-editable { width: fit-content; }

.board-jacket-description.empty {
  color: var(--ink-faint);
  font-style: italic;
}

.board-jacket .board-jacket-description-input {
  display: block;
  max-width: 44rem;
  margin-top: 12px;
}

/* The preview, the papers and the waiting clips each stand a little apart
   from what is above them, as the paper page's sections do. */
.board-jacket .board-preview { margin-top: 20px; }

.board-jacket-section { margin-top: 24px; }
.board-jacket-section .kicker { margin: 0 0 6px; }

.board-jacket-papers {
  margin: 0;
  padding: 0;
  list-style: none;
}

/* The title, and under it who and when: the same two lines whatever the
   title's length, so the list reads as a column. */
.board-jacket-papers li {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 7px 0;
  border-top: 1px solid var(--line);
}

.board-jacket-papers li:last-child { border-bottom: 1px solid var(--line); }

.board-jacket-papers a {
  min-width: 0;
  color: var(--ink);
  text-decoration: none;
  overflow-wrap: anywhere;
}

.board-jacket-papers a:hover { color: var(--accent); text-decoration: underline; }

.board-jacket-papers span {
  color: var(--ink-faint);
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  white-space: nowrap;
}

.board-jacket-more {
  margin: 6px 0 0;
  color: var(--ink-faint);
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
}

.board-jacket-section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 10px;
}

.board-jacket-section-head p {
  margin: 0;
  color: var(--ink-faint);
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
}

.board-jacket-section-head button {
  flex: none;
  padding: 6px 12px;
  font-size: var(--fs-xs);
}

.board-jacket-staged {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 8px;
}

.board-jacket-staged-item,
.board-jacket-staged-more {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--accent-line);
  border-radius: var(--radius);
  background: var(--accent-soft);
}

.board-jacket-staged-item > span {
  color: var(--accent);
  font: 700 var(--fs-2xs) var(--font-ui);
  letter-spacing: .04em;
  text-transform: uppercase;
}

.board-jacket-staged-item p {
  display: -webkit-box;
  margin: 5px 0 0;
  overflow: hidden;
  font-size: var(--fs-sm);
  line-height: 1.4;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

.board-jacket-staged-item small {
  display: block;
  margin-top: 6px;
  overflow: hidden;
  color: var(--ink-faint);
  font: var(--fs-2xs) var(--font-ui);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.board-jacket-staged-more {
  display: grid;
  min-height: 86px;
  place-items: center;
  color: var(--ink-soft);
  font: 600 var(--fs-sm) var(--font-ui);
}

/* A board seen from a distance, every card where it sits. The frame takes
   the proportions of the cards' own extent (--preview-ratio, set by
   BoardPreview), no taller than 320px — 200px on a phone — and no wider than
   the panel, centred in it: the cards fill it rather than floating in it. */
.board-preview {
  --preview-height: 320px;
  position: relative;
  display: grid;
  width: min(100%, calc(var(--preview-height) * var(--preview-ratio, 1.6)));
  aspect-ratio: var(--preview-ratio, 1.6);
  margin-inline: auto;
  overflow: hidden;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-lg);
  background-color: var(--paper-sunken);
  background-image: radial-gradient(circle, var(--line-strong) .65px, transparent .75px);
  background-size: 16px 16px;
  cursor: pointer;
  user-select: none;
  transition: border-color var(--motion-fast) var(--ease-out);
}

.board-preview:hover,
.board-preview:focus-visible {
  border-color: var(--accent);
  outline: none;
}

.board-preview svg {
  width: 100%;
  height: 100%;
}

@media (max-width: 600px) {
  .board-preview { --preview-height: 200px; }
}

.board-preview-card rect {
  fill: var(--card);
  stroke: var(--line-strong);
  stroke-width: 1.5;
  filter: drop-shadow(0 3px 3px rgba(29,33,41,.10));
}

.board-preview-card line {
  stroke: var(--line);
  stroke-width: 1;
}

.board-preview-card text {
  fill: var(--ink-soft);
  font: 14px var(--font-serif);
  pointer-events: none;
}

.board-preview-card text.kind {
  fill: var(--ink-faint);
  font: 700 10px var(--font-ui);
  letter-spacing: .6px;
  text-transform: uppercase;
}

.board-preview-card.comment rect {
  fill: var(--accent-soft);
  stroke: var(--accent-line);
}

.board-preview.empty {
  width: 100%;
  min-height: 180px;
  aspect-ratio: auto;
  align-content: center;
  justify-items: center;
  gap: 5px;
  padding: 28px 20px;
  color: var(--ink-faint);
  background-image: none;
  font: var(--fs-sm) var(--font-ui);
  text-align: center;
}

.board-preview.empty svg {
  width: 40px;
  height: 40px;
  margin-bottom: 4px;
  padding: 0;
  fill: none;
  stroke: var(--line-strong);
  stroke-width: 1.2;
}

.board-preview.empty strong {
  color: var(--ink-soft);
  font-size: var(--fs-base);
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
  /* Shrink but never grow: the free space goes to the chips' auto margin
     below instead of to the heading. A long title still gives way rather
     than pushing anything off the line. */
  flex: 0 1 auto;
  min-width: 0;
  line-height: 1.3;
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
   gold is the app's "this person holds a role here" hue, as on a
   project keeper's chip. */
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
.paper-actions .button.primary,
.paper-brief-actions .button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--ink-inverse);
}

.paper-actions .button.primary:hover,
.paper-brief-actions .button.primary:hover {
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

/* A reader's summary, when they share it: a few lines of it, since the
   pop is a glance and not the place to read it. */
.chip-pop-summary {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  overflow: hidden;
  margin-top: 4px;
  font-size: var(--fs-sm);
  color: var(--ink-soft);
  white-space: pre-wrap;
}

.chip-pop-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 5px;
}

.chip-pop-tag {
  padding: 1px 7px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-pill);
  font-size: var(--fs-2xs);
  color: var(--ink-soft);
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

.nooks-label {
  font-size: var(--fs-sm);
  color: var(--ink-soft);
}

/* The profile page is settings from top to bottom: nothing on it is prose
   the user wrote, it is all structured configuration, which the type
   roles put in the interface font. Same reasoning as the forms above,
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

/* ---------- My activity (ActivityPanel.jsx) ----------
   One grammar for day and week: time runs left to right across a day,
   each span a block where it was and as long as it was, so "when" and
   "how much" are read off the same marks. A month is a calendar whose
   days are shaded by how much, at fixed marks, and open into their day.
   Colour says what the time was spent on and nothing else; every block
   and day also says it in words, to a hover, to focus, and to a screen
   reader. */
.activity-panel .panel-head-row { align-items: center; margin-bottom: var(--space-1); }
.activity-panel .panel-title { margin-bottom: 0; }

.activity-views {
  display: inline-flex;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  overflow: hidden;
}

.activity-views button {
  border: 0;
  border-radius: 0;
  background: var(--card);
  color: var(--ink-soft);
  font-size: var(--fs-sm);
  padding: var(--space-1) var(--space-3);
  min-height: 32px;
}

.activity-views button + button { border-left: 1px solid var(--line-strong); }
.activity-views button:hover { background: var(--paper); color: var(--ink); }
.activity-views button[aria-pressed='true'] { background: var(--accent); color: var(--ink-inverse); }

.activity-period {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: var(--space-4) 0 var(--space-3);
}

.activity-period-label {
  font-family: var(--font-serif);
  font-size: var(--fs-lg);
  font-weight: normal;
  margin: 0;
  min-width: 0;
}

.activity-step {
  width: 32px;
  height: 32px;
  padding: 0;
  font-size: var(--fs-lg);
  line-height: 1;
  background: var(--card);
}

.activity-step:disabled { opacity: 0.35; cursor: default; }
.activity-today { font-size: var(--fs-sm); padding: var(--space-1) var(--space-3); }
.activity-period-tools { margin-left: auto; display: inline-flex; align-items: center; gap: var(--space-2); }

/* ---------- A week or month paper by paper ----------
   Small multiples: a row to each paper, a column to each day, one scale.
   Columns grow from a shared baseline; an empty day is a faint tick on it,
   so a row still reads as its days. */
.activity-paper-row {
  display: grid;
  grid-template-columns: minmax(0, 220px) minmax(0, 1fr) 48px;
  align-items: end;
  gap: var(--space-3);
  padding: 6px 0;
  border-top: 1px solid var(--line);
  transition: opacity var(--motion-fast) var(--ease-out);
}

.activity-paper-row.is-faded { opacity: 0.2; }
.activity-papers-head { border-top: 0; padding-bottom: 2px; align-items: center; }

.activity-paper-name {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  align-self: center;
}

.activity-paper-name a,
.activity-paper-name .activity-subject-gone {
  font-family: var(--font-serif);
  font-size: var(--fs-md);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity-columns {
  display: grid;
  grid-template-columns: repeat(var(--activity-days), minmax(0, 1fr));
  gap: 2px;
  height: 36px;
}

.activity-papers.is-week .activity-columns { gap: var(--space-2); }
.activity-papers-head .activity-columns { height: auto; }

.activity-papers-head .activity-columns span {
  font-size: var(--fs-2xs);
  color: var(--ink-faint);
  text-align: center;
  white-space: nowrap;
}

.activity-papers.is-month .activity-papers-head .activity-columns span { text-align: left; }

.activity-column {
  display: flex;
  align-items: flex-end;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  background: none;
  box-shadow: none;
}

.activity-column:hover { background: var(--paper); }
.activity-column i { display: block; width: 100%; max-width: 24px; margin: 0 auto; border-radius: 3px 3px 0 0; }
.activity-paper-row .activity-row-total { align-self: center; }

.activity-papers-note {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  margin: var(--space-2) 0 0;
  font-size: var(--fs-xs);
  color: var(--ink-faint);
}

.activity-papers-note .activity-more { margin-top: 0; }

/* The period's time, said once above the chart. */
.activity-total {
  margin: 0 0 var(--space-4);
  font-size: var(--fs-sm);
  color: var(--ink-soft);
}

.activity-total strong { font-size: var(--fs-xl); font-weight: normal; color: var(--ink); font-variant-numeric: tabular-nums; }

.activity-swatch {
  display: inline-block;
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.activity-paper-1 { background: var(--activity-paper-1); }
.activity-paper-2 { background: var(--activity-paper-2); }
.activity-paper-3 { background: var(--activity-paper-3); }
.activity-paper-4 { background: var(--activity-paper-4); }
.activity-other { background: var(--activity-other); }

/* One paper picked out, by hovering its blocks or its line in the list:
   every other stretch of time steps back. */
.activity-block,
.activity-subjects li { transition: opacity var(--motion-fast) var(--ease-out); }
.activity-block.is-faded,
.activity-subjects li.is-faded { opacity: 0.2; }

.activity-figure { position: relative; }

.activity-row {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) 48px;
  align-items: center;
  gap: var(--space-2);
  min-height: 28px;
}

.activity-row-label {
  font-size: var(--fs-sm);
  color: var(--ink-soft);
  white-space: nowrap;
}

.activity-day-link {
  border: 0;
  background: none;
  box-shadow: none;
  padding: 0;
  text-align: left;
  color: var(--ink-soft);
}

.activity-day-link:hover { color: var(--accent); text-decoration: underline; }
.activity-row.is-today .activity-row-label { color: var(--ink); font-weight: 600; }

.activity-row-total {
  font-size: var(--fs-xs);
  color: var(--ink-soft);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.activity-track {
  position: relative;
  height: 20px;
  border-bottom: 1px solid var(--line);
}

.activity-day .activity-track { height: 28px; }

.activity-gridline {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--line);
  opacity: 0.6;
}

.activity-now {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  margin-left: -1px;
  background: var(--ink-faint);
}

/* At least 3px wide, so a two-minute span is a mark that can be found and
   hovered rather than a hairline. Touching blocks are kept apart by a gap
   of the card's own colour, not by an outline. */
.activity-block {
  position: absolute;
  top: 3px;
  bottom: 0;
  min-width: 3px;
  border-radius: 3px 3px 0 0;
  outline: 1px solid var(--card);
}

.activity-block:hover,
.activity-block:focus-visible { filter: brightness(0.85); }

.activity-axis {
  position: relative;
  height: 18px;
  font-size: var(--fs-2xs);
  color: var(--ink-faint);
}

.activity-axis span { position: absolute; top: 3px; transform: translateX(-50%); white-space: nowrap; }
.activity-axis span:first-child { transform: none; }
.activity-axis span:last-child { transform: translateX(-100%); }

.activity-calendar {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 3px;
}

.activity-weekday {
  text-align: center;
  font-size: var(--fs-xs);
  color: var(--ink-faint);
  padding-bottom: 2px;
}

.activity-cell {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: flex-start;
  min-height: 52px;
  padding: 4px 6px;
  border: 0;
  border-radius: var(--radius);
  background: var(--paper);
  color: var(--ink-soft);
  font-size: var(--fs-xs);
  text-align: left;
}

.activity-cell:hover { background: var(--paper); box-shadow: inset 0 0 0 1px var(--ink-faint); }
.activity-cell.is-outside { opacity: 0.45; }
.activity-cell.is-today { box-shadow: inset 0 0 0 2px var(--ink); }
.activity-cell-day { font-variant-numeric: tabular-nums; }
.activity-cell-total { align-self: flex-end; font-weight: 600; font-variant-numeric: tabular-nums; }

.activity-shade-1,
.activity-cell.activity-shade-1:hover { background: var(--activity-heat-1); color: var(--ink); }
.activity-shade-2,
.activity-cell.activity-shade-2:hover { background: var(--activity-heat-2); color: var(--ink); }
.activity-shade-3,
.activity-cell.activity-shade-3:hover { background: var(--activity-heat-3); color: var(--ink); }
.activity-shade-4,
.activity-cell.activity-shade-4:hover { background: var(--activity-heat-4); color: var(--ink-inverse); }
.activity-shade-5,
.activity-cell.activity-shade-5:hover { background: var(--activity-heat-5); color: var(--ink-inverse); }

.activity-scale {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 3px;
  margin-top: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--ink-faint);
}

.activity-scale i { width: 14px; height: 14px; border-radius: 2px; }
.activity-scale span:first-child { margin-right: 4px; }
.activity-scale span:last-child { margin-left: 4px; }

.activity-tip {
  position: absolute;
  z-index: 5;
  transform: translate(-50%, calc(-100% - 8px));
  display: grid;
  gap: 2px;
  max-width: 260px;
  width: max-content;
  padding: var(--space-2) var(--space-3);
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  font-size: var(--fs-xs);
  color: var(--ink-soft);
  pointer-events: none;
}

.activity-tip strong { color: var(--ink); font-family: var(--font-serif); font-size: var(--fs-sm); font-weight: normal; }

.activity-subjects { margin-top: var(--space-5); }
.activity-subjects .kicker { font-family: var(--font-ui); font-size: var(--fs-sm); color: var(--ink-soft); font-variant: small-caps; letter-spacing: 0.04em; margin: 0 0 var(--space-2); }
.activity-subjects ol { list-style: none; margin: 0; padding: 0; }

.activity-subjects li {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) minmax(40px, 120px) minmax(88px, max-content);
  align-items: center;
  gap: var(--space-2);
  padding: 6px 0;
  border-top: 1px solid var(--line);
}

.activity-subjects li a,
.activity-subject-gone {
  font-family: var(--font-serif);
  font-size: var(--fs-md);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity-subject-gone { color: var(--ink-faint); }
.activity-subject-bar { height: 6px; }
.activity-subject-bar i { display: block; height: 100%; border-radius: 0 3px 3px 0; }
.activity-subject-time { text-align: right; white-space: nowrap; font-size: var(--fs-sm); color: var(--ink-soft); font-variant-numeric: tabular-nums; }

.activity-more {
  margin-top: var(--space-2);
  border: 0;
  background: none;
  box-shadow: none;
  padding: 0;
  color: var(--accent);
  font-size: var(--fs-sm);
}

.activity-empty { color: var(--ink-faint); font-size: var(--fs-sm); margin: var(--space-4) 0 0; }

@media (max-width: 560px) {
  .activity-panel .panel-head-row { flex-wrap: wrap; }
  .activity-row { grid-template-columns: 48px minmax(0, 1fr) 40px; gap: 6px; }
  .activity-cell { min-height: 40px; padding: 3px 4px; }
  .activity-cell-total { font-size: var(--fs-2xs); }
  .activity-subjects li { grid-template-columns: 10px minmax(0, 1fr) max-content; }
  .activity-period { flex-wrap: wrap; }
  .activity-period-tools { flex-basis: 100%; margin-left: 0; }
  .activity-paper-row { grid-template-columns: minmax(0, 1fr) 40px; row-gap: 4px; }
  .activity-paper-row .activity-paper-name { grid-column: 1 / -1; }
  .activity-papers-head .activity-columns { grid-column: 1; }
  .activity-papers-head > span:first-child { display: none; }
  .activity-subject-bar { display: none; }
}

/* A paper's effort on its user's own nook: a small pill at the end of its
   author line, the clock and the time on a tint of its level — five fixed
   steps of the one-hue activity ramp, light to dark, so a glance down the
   nook reads which papers took the most. The level is a measure, not a
   goal, so it is a colour and a number and never a bar. It is a button,
   and opens the paper's time (EffortPop), which carries the key. */
.nook-effort-anchor { position: relative; display: inline-flex; }

.nook-effort {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-height: 0;
  margin: 0;
  padding: 1px 7px 1px 5px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--paper-sunken);
  box-shadow: none;
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  font-style: normal;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
  white-space: nowrap;
  cursor: pointer;
}

.nook-effort:hover,
.nook-effort[aria-expanded='true'] { box-shadow: 0 0 0 1px var(--accent); }

.effort-level-1 { background: var(--activity-heat-1); color: var(--ink); }
.effort-level-2 { background: var(--activity-heat-2); color: var(--ink); }
.effort-level-3 { background: var(--activity-heat-3); color: var(--ink); }
.effort-level-4 { background: var(--activity-heat-4); color: var(--ink-inverse); }
.effort-level-5 { background: var(--activity-heat-5); color: var(--ink-inverse); }

.effort-levels {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: 4px;
  font-size: var(--fs-xs);
  color: var(--ink-soft);
}

.effort-levels-scale { display: inline-flex; gap: 2px; }
.effort-levels-scale i { width: 14px; height: 10px; border-radius: 2px; }
.effort-levels-scale i.is-current { box-shadow: 0 0 0 1.5px var(--card), 0 0 0 3px var(--ink); }

.nook-effort svg {
  width: 11px;
  height: 11px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.2;
  stroke-linecap: round;
}

.effort-pop {
  position: absolute;
  top: calc(100% + 6px);
  left: -4px;
  z-index: 40;
  width: 340px;
  max-width: calc(100vw - 32px);
  padding: var(--space-3) var(--space-4);
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  font-family: var(--font-ui);
  font-style: normal;
  font-size: var(--fs-sm);
  color: var(--ink-soft);
  cursor: default;
}

.effort-pop .kicker { margin: 0; font-size: var(--fs-xs); font-variant: small-caps; letter-spacing: 0.04em; color: var(--ink-soft); }
.effort-pop-head { display: flex; align-items: center; justify-content: space-between; }

.effort-pop-close {
  width: 24px;
  height: 24px;
  min-height: 0;
  padding: 0;
  border: 0;
  background: none;
  box-shadow: none;
  font-size: var(--fs-lg);
  line-height: 1;
  color: var(--ink-faint);
}

.effort-pop-close:hover { color: var(--ink); background: var(--paper); }
.effort-pop-total { margin: 2px 0 0; font-size: var(--fs-xl); color: var(--ink); font-variant-numeric: tabular-nums; }
.effort-pop-note { margin: 2px 0 0; font-size: var(--fs-xs); color: var(--ink-faint); }

/* Twelve weeks as twelve columns, Monday at the top: the month view's
   shading, at a size that fits in the hand. */
.effort-weeks {
  display: grid;
  grid-auto-flow: column;
  grid-template-rows: repeat(7, 12px);
  grid-auto-columns: 12px;
  gap: 3px;
  margin-top: var(--space-3);
}

.effort-weeks i { border-radius: 2px; }
.effort-weeks .activity-shade-0 { background: var(--paper-sunken); }
.effort-weeks i.is-future { background: none; }

.effort-pop .effort-pop-days-title { margin-top: var(--space-3); }
.effort-pop-days { list-style: none; margin: var(--space-1) 0 0; padding: 0; }

.effort-pop-days li {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr) max-content;
  gap: var(--space-3);
  white-space: nowrap;
  padding: 4px 0;
  border-top: 1px solid var(--line);
  font-variant-numeric: tabular-nums;
}

.effort-pop-when { color: var(--ink-faint); }
.effort-pop-when { overflow: hidden; text-overflow: ellipsis; }
.effort-pop-time { text-align: right; color: var(--ink); }
.effort-pop-link { display: inline-block; margin-top: var(--space-3); font-size: var(--fs-sm); }

/* The author line as two items, the prose and the effort, centred on each
   other: on the baseline, the smaller upright face rode low beside the
   serif italic. It wraps under the authors when they fill the line. */
.paper-meta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: var(--space-2);
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

/* ---------- Buttons & inbox ---------- */

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

/* ---------- Home ---------- */

/* The page a visitor lands on: the doors, then Papol to try, one window
   after another. Nothing is explained; what can be tried beckons until it
   has been. */
.landing { display: grid; gap: 56px; padding-bottom: 24px; }

.landing-hero { padding: 28px 0 0; }
.landing-title {
  max-width: 20ch;
  color: var(--ink);
  font-size: clamp(2.1rem, 6vw, 3.1rem);
  font-weight: 600;
  line-height: 1.08;
  letter-spacing: -0.01em;
  text-wrap: balance;
}
.landing-fact { margin-top: 14px; color: var(--ink-soft); font: var(--fs-lg)/1.5 var(--font-ui); }
.landing-doors { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 12px; margin-top: 26px; }
.landing-button {
  display: inline-block;
  padding: 9px 20px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--card);
  box-shadow: 0 1px 0 rgba(29, 33, 41, 0.12);
  color: var(--ink);
  font: var(--fs-md)/1.5 var(--font-ui);
  text-decoration: none;
  transition: background-color var(--motion-fast) var(--ease-out), border-color var(--motion-fast) var(--ease-out), color var(--motion-fast) var(--ease-out);
}
.landing-button:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.landing-button.primary { border-color: var(--accent); background: var(--accent); color: var(--ink-inverse); }
.landing-button.primary:hover { background: var(--accent-strong); color: var(--ink-inverse); }

.landing-place-section { scroll-margin-top: 16px; }
.landing .landing-number { margin: 0 0 12px; color: var(--accent); font: 600 var(--fs-sm)/1 var(--font-ui); letter-spacing: 0.08em; text-transform: uppercase; }

/* Something to try, until it has been: a soft ring that breathes. */
.beckon { animation: beckon 2.2s var(--ease-out) infinite; }
@keyframes beckon {
  0% { box-shadow: 0 0 0 0 rgba(43, 74, 111, 0.45); }
  70%, 100% { box-shadow: 0 0 0 8px rgba(43, 74, 111, 0); }
}

/* The specimen: a viewer window around one page of the paper. */
.specimen { display: grid; gap: 14px; }
.specimen-window {
  overflow: hidden;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-lg);
  background: var(--paper-sunken);
  box-shadow: var(--shadow-md);
}
.specimen-toolbar {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  background: var(--card);
  font-family: var(--font-ui);
}
.specimen-home { flex: none; width: 18px; height: 18px; fill: none; stroke: var(--ink-soft); stroke-width: 1.4; stroke-linejoin: round; }
.specimen-doc-title { flex: 1; min-width: 0; overflow: hidden; color: var(--ink-faint); font-size: var(--fs-xs); white-space: nowrap; text-overflow: ellipsis; }
.specimen-tools { display: inline-flex; gap: 4px; flex: none; }
.specimen-tool { position: relative; display: grid; place-items: center; width: 34px; height: 32px; padding: 0; }
.specimen-tool svg { width: 16px; height: 16px; fill: currentColor; }
.specimen-key { position: absolute; right: 3px; bottom: 1px; font: 600 8px/1 var(--font-ui); opacity: 0.7; }
.specimen-tool.active,
.specimen-tool.active:hover { border-color: var(--accent); background: var(--accent); color: var(--ink-inverse); }

.specimen-page {
  position: relative;
  margin: 18px;
  padding: 26px 30px 22px;
  background: var(--card);
  box-shadow: var(--shadow-sm);
  color: #14161a;
  font-size: var(--fs-md);
  line-height: 1.55;
}
.specimen-running-head { display: flex; justify-content: space-between; margin-bottom: 14px; color: var(--ink-faint); font: var(--fs-2xs)/1 var(--font-ui); letter-spacing: 0.04em; }
.specimen-folio { margin-top: 12px; color: var(--ink-faint); font: var(--fs-2xs)/1 var(--font-ui); text-align: right; }
.specimen-masthead { margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--line); text-align: center; }
.specimen-title { max-width: 30ch; margin: 0 auto; font-size: var(--fs-xl); font-weight: 600; line-height: 1.25; }
.specimen-authors { margin-top: 6px; font-size: var(--fs-sm); }
.specimen-elision { color: var(--ink-faint); }
.specimen-page sub { font-size: 0.72em; line-height: 0; }
.specimen-columns { columns: 2; column-gap: 24px; text-align: justify; hyphens: auto; }

.specimen-sentence { border-radius: 2px; transition: background-color var(--motion-base) var(--ease-out), box-shadow var(--motion-base) var(--ease-out); }
.specimen-sentence.painted { background: rgba(217, 43, 31, 0.2); box-shadow: 0 0 0 1px rgba(217, 43, 31, 0.08); }
.specimen-page.painting { cursor: crosshair; }
.specimen-sentence.paintable:hover { background: rgba(217, 43, 31, 0.1); }
.specimen-sentence.paintable.painted:hover { background: rgba(217, 43, 31, 0.26); }
.specimen-sentence:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.specimen-sentence.flash { animation: specimen-flash 1.6s var(--ease-out); }
@keyframes specimen-flash {
  0%, 30% { box-shadow: 0 0 0 3px var(--gold-line); background-color: var(--gold-soft); }
  100% { box-shadow: 0 0 0 3px transparent; }
}

/* Inline controls in the page's text: they read as the text they are. */
.specimen-cite,
.specimen-link {
  display: inline;
  padding: 0 1px;
  border: 0;
  border-radius: 2px;
  background: none;
  box-shadow: none;
  color: var(--accent);
  font: inherit;
  line-height: inherit;
  cursor: pointer;
}
.specimen-cite:focus-visible,
.specimen-link:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.specimen-cite { position: relative; padding: 0 3px; font-size: 0.72em; vertical-align: super; line-height: 1; }
.specimen-cite::after { content: ''; position: absolute; inset: -8px -6px; }
.specimen-cite:hover:not(:disabled),
.specimen-link:hover:not(:disabled) { border: 0; background: var(--accent-soft); color: var(--accent); }
.specimen-cite.active,
.specimen-cite.active:hover { background: var(--accent); color: var(--ink-inverse); }
.specimen-page.painting .specimen-cite,
.specimen-page.painting .specimen-link { pointer-events: none; color: inherit; animation: none; }

.specimen-figure { margin: 18px 0 4px; text-align: center; }
.specimen-figure .fold-plot { width: 100%; max-width: 380px; height: auto; }
.specimen-figure figcaption { margin-top: 4px; color: var(--ink-soft); font-size: var(--fs-xs); }
.plot-grid { fill: none; stroke: var(--line); stroke-width: 0.8; }
.plot-bar { fill: var(--fill-strong); }
.plot-bar.own { fill: var(--accent); }
.plot-ci { fill: none; stroke: var(--ink); stroke-width: 1; }
.plot-atom { fill: none; stroke: var(--gold); stroke-width: 1.2; stroke-dasharray: 3 2; }
.plot-label { fill: var(--ink-soft); font: 8px var(--font-ui); }
.plot-label.end { text-anchor: end; }
.plot-label.middle { text-anchor: middle; }

.specimen-references {
  margin-top: 16px; padding-top: 10px;
  border-top: 1px solid var(--line);
  list-style: none;
  color: var(--ink-soft);
  font-size: var(--fs-2xs);
  line-height: 1.5;
}
.specimen-references li + li { margin-top: 2px; }
.specimen-references span { display: inline-block; min-width: 1.8em; }
.specimen-licence { margin-top: 10px; color: var(--ink-faint); font: var(--fs-2xs)/1.5 var(--font-ui); }
.specimen-licence a { color: inherit; }

.specimen-card {
  position: absolute; z-index: 3;
  padding: 12px 14px 10px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-lg);
  background: var(--card);
  box-shadow: var(--shadow-overlay);
  color: var(--ink);
  text-align: left;
  transition: top var(--motion-base) var(--ease-out), left var(--motion-base) var(--ease-out);
  animation: specimen-rise var(--motion-base) var(--ease-out);
}
.specimen-card:focus { outline: none; }
.specimen-card-works {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  margin: -4px -4px 8px; padding-bottom: 6px;
  border-bottom: 1px solid var(--line);
  color: var(--ink-faint);
  font: var(--fs-xs) var(--font-ui);
}
.specimen-card-works button { padding: 0 9px; font-size: var(--fs-sm); line-height: 1.4; }
.specimen-card-title { font-size: var(--fs-md); font-weight: 600; line-height: 1.35; }
.specimen-card-meta { margin-top: 3px; color: var(--ink-soft); font-size: var(--fs-xs); line-height: 1.4; }
.specimen-card-steps {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  margin-top: 10px; padding-top: 8px;
  border-top: 1px solid var(--line);
  color: var(--ink-soft);
  font: var(--fs-xs) var(--font-ui);
}
.specimen-card-steps b { color: var(--ink); font-weight: 600; }
.specimen-card-arrows { display: inline-flex; gap: 4px; }
.specimen-card-arrows button { width: 28px; padding: 1px 0; font-size: var(--fs-sm); }
@keyframes specimen-rise { from { opacity: 0; transform: translateY(4px); } }

.specimen-figure-stage {
  position: absolute; inset: 0; z-index: 4;
  display: grid; place-content: center; justify-items: center; gap: 16px;
  background: rgba(245, 246, 248, 0.95);
  animation: specimen-fade var(--motion-base) var(--ease-out);
}
.specimen-figure.large { width: min(420px, 80vw); margin: 0; animation: specimen-zoom 280ms var(--ease-out); }
.specimen-figure.large .fold-plot { max-width: none; filter: drop-shadow(0 8px 20px rgba(29, 33, 41, 0.1)); background: var(--card); }
.specimen-figure.large figcaption { font-size: var(--fs-sm); text-align: center; }
.specimen-redrawn { display: block; margin-top: 2px; color: var(--ink-faint); font: italic var(--fs-2xs) var(--font-serif); font-variant: normal; }
.specimen-return {
  padding: 6px 14px;
  border-color: var(--accent);
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--ink-inverse);
  font-size: var(--fs-sm);
}
.specimen-return:hover:not(:disabled) { background: var(--accent-strong); color: var(--ink-inverse); }
@keyframes specimen-fade { from { opacity: 0; } }
@keyframes specimen-zoom { from { opacity: 0; transform: scale(0.45) translate(30%, 10%); } }

.specimen-landed {
  justify-self: center;
  padding: 5px 14px;
  border: 1px solid var(--accent-line);
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  color: var(--accent-strong);
  font: var(--fs-sm) var(--font-ui);
  text-decoration: none;
  animation: specimen-rise var(--motion-base) var(--ease-out);
}
.specimen-landed:hover { border-color: var(--accent); }

.specimen-backlink {
  justify-self: start;
  padding: 0; border: 0; background: none; box-shadow: none;
  color: var(--accent);
  font: var(--fs-2xs) var(--font-ui);
  text-align: left;
}
.specimen-backlink:hover:not(:disabled) { border: 0; background: none; color: var(--accent); text-decoration: underline; }

/* The board: a canvas of cards, the way the board draws them; each card
   can be picked up and put down anywhere. */
.board-mock { overflow: hidden; border: 1px solid var(--line-strong); border-radius: var(--radius-lg); background: var(--card); box-shadow: var(--shadow-md); }
.board-mock-bar { display: flex; align-items: baseline; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid var(--line); }
.board-mock-name { font-size: var(--fs-lg); font-weight: 600; }
.board-mock-bar-end { display: inline-flex; align-items: baseline; gap: 12px; }
.board-mock-tidy { padding: 2px 10px; border: 1px solid var(--line-strong); border-radius: var(--radius); color: var(--ink-soft); font: var(--fs-xs)/1.5 var(--font-ui); }
.board-mock-count { color: var(--ink-faint); font: var(--fs-xs) var(--font-ui); }
.board-mock-canvas {
  display: grid; grid-template-columns: 1fr 1.15fr 1fr; align-items: start; gap: 16px;
  min-height: 300px;
  padding: 18px 16px 22px;
  background-color: var(--paper);
  background-image: radial-gradient(var(--line-strong) 1px, transparent 1px);
  background-size: 18px 18px;
}
.board-mock-booklet,
.board-mock-loose,
.board-mock-collection { display: grid; gap: 10px; }
.board-mock-booklet { padding-left: 12px; border-left: 2px solid var(--line-strong); }
.board-mock-collection { padding: 10px; border: 1px solid var(--line-strong); border-radius: var(--radius-lg); background: rgba(255, 255, 255, 0.5); }
.board-mock-group-title { font-size: var(--fs-sm); font-weight: 700; }
.board-mock-card {
  position: relative;
  display: grid; gap: 6px;
  padding: 9px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--card);
  box-shadow: var(--shadow-sm);
  font-size: var(--fs-xs);
  line-height: 1.45;
  cursor: grab;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
.board-mock-card:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.board-mock-card[data-lifted] { z-index: 2; box-shadow: var(--shadow-md); }
.board-mock-card[data-returning] { transition: transform 320ms var(--ease-out); }
.board-mock-card:active { cursor: grabbing; }
.board-mock-card.excerpt { border-left: 3px solid rgba(217, 43, 31, 0.55); animation: board-land 420ms var(--ease-out); }
@keyframes board-land { from { opacity: 0; transform: translateY(-26px) scale(0.92); } }
.board-mock-kind { color: var(--ink-faint); font: 600 var(--fs-2xs)/1 var(--font-ui); letter-spacing: 0.08em; text-transform: uppercase; }
.board-mock-file { color: var(--accent); font: var(--fs-xs) var(--font-ui); word-break: break-word; }
.board-mock-image { display: block; width: 100%; height: 64px; border-radius: 3px; }
.board-mock-image.video { display: grid; place-items: center; background: linear-gradient(135deg, #2f3440, #555d6b); color: rgba(255, 255, 255, 0.85); font-size: 18px; }
.board-mock-image.distances { width: auto; height: 72px; justify-self: center; background: var(--paper-sunken); }
.board-mock-image.distances rect { fill: var(--accent); }
.board-mock-image.thumb { border: 1px solid var(--line); background: var(--card); }
.thumb-bar, .thumb-picture { fill: var(--fill); }
.thumb-title { fill: var(--line-strong); }
.thumb-line { fill: var(--line); }

/* The Library: the paper's jacket, which the visitor can add to. */
.landing-jacket {
  padding: 18px 20px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-lg);
  background: var(--card);
  box-shadow: var(--shadow-md);
}
.landing-jacket-title { font-size: var(--fs-xl); font-weight: 600; line-height: 1.3; }
.landing-jacket-meta { margin-top: 4px; color: var(--ink-faint); font-size: var(--fs-xs); }
.landing-readers { display: grid; gap: 10px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); list-style: none; }
.landing-readers li { display: grid; grid-template-columns: 28px 1fr; align-items: start; gap: 10px; font-size: var(--fs-sm); line-height: 1.4; }
.landing-readers li.own { animation: specimen-rise 300ms var(--ease-out); }
.landing-readers b { display: block; font: 600 var(--fs-xs) var(--font-ui); }
.landing-readers q { color: var(--ink-soft); }
.landing-avatar { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; color: var(--ink-inverse); font: 600 var(--fs-xs)/1 var(--font-ui); }
.landing-avatar.tint-0 { background: var(--identity-0); }
.landing-avatar.tint-1 { background: var(--identity-1); }
.landing-avatar.tint-2 { background: var(--identity-2); }
.landing-avatar.tint-4 { background: var(--identity-4); }
.landing-thought-form { display: flex; gap: 8px; margin-top: 12px; }
.landing-thought-form input {
  flex: 1; min-width: 0;
  padding: 7px 10px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--card);
}
.landing-thought-form input:focus { outline: 0; border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.landing-thought-form button { padding: 6px 14px; }

.landing-close { display: grid; justify-items: center; padding: 40px 24px 28px; border-radius: var(--radius-lg); background: var(--accent-soft); text-align: center; }
.landing-close h2 { color: var(--ink); font-size: var(--fs-hero); font-weight: 600; }
.landing-close .landing-doors { justify-content: center; margin-top: 20px; }
.landing-footer { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 22px; margin-top: -28px; color: var(--ink-faint); font: var(--fs-xs) var(--font-ui); }
.landing-footer a { color: inherit; text-decoration: none; }
.landing-footer a:hover { color: var(--accent); text-decoration: underline; }

@media (max-width: 720px) {
  .specimen-columns { text-align: left; hyphens: manual; }
}

@media (max-width: 640px) {
  .landing { gap: 44px; }
  .specimen-page { margin: 10px; padding: 18px 16px 16px; }
  .specimen-columns { columns: 1; }
  .board-mock-canvas { grid-template-columns: 1fr; gap: 12px; }
  .specimen-doc-title { visibility: hidden; }
}

@media (prefers-reduced-motion: reduce) {
  .beckon, .specimen-card, .specimen-figure-stage, .specimen-figure.large,
  .board-mock-card.excerpt, .specimen-sentence.flash, .landing-readers li.own, .specimen-landed { animation: none; }
  .board-mock-card[data-returning] { transition: none; }
}

/* ---------- About ---------- */

/* One piece of prose in one typeface, the page's serif, at two sizes:
   the title and the paragraphs, all in the same ink. No kicker, no small
   capitals, no larger first paragraph, and a line held to a readable
   measure whatever the window's width. */
.about-story {
  padding: 36px 40px 40px;
  font-family: var(--font-serif);
  color: var(--ink);
}

.about-story h1 {
  margin: 0;
  font-size: var(--fs-2xl);
  font-weight: 600;
  line-height: 1.25;
  text-wrap: balance;
}

.about-story h1 + p { margin-top: 18px; }

.about-story p {
  margin: 0;
  max-width: 62ch;
  font-size: var(--fs-base);
  line-height: 1.7;
}

.about-story p + p { margin-top: 14px; }

.about-story a {
  color: var(--accent);
  text-underline-offset: 3px;
}

@media (max-width: 560px) {
  .about-story { padding: 24px 20px 28px; }
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

/* Tinted by who sees it, as the ratings are. */
.inline-thought-text {
  margin: 0;
  padding: 8px 12px;
  background: var(--vis-soft, var(--green-soft));
  border-radius: var(--radius);
  font-size: var(--fs-md);
  white-space: pre-wrap;
}

.inline-thought > .inline-edit {
  padding: 8px 12px;
  background: var(--vis-soft, var(--green-soft));
  border-radius: var(--radius);
}

.inline-thought > .inline-edit .inline-edit-box {
  border-color: var(--vis-line, var(--green-line));
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
  background: var(--vis-soft, var(--green-soft));
  color: var(--vis-ink, var(--green-ink));
}

/* Summary sits beside Notes as an equal: same heading level, and its
   text is carded like a note. */
.summary-block {
  margin-bottom: 14px;
}

.summary-text {
  padding: 8px 12px;
  background: var(--vis-soft, var(--accent-soft));
  border-radius: var(--radius);
  font-size: var(--fs-md);
  white-space: pre-wrap;
}

.summary-block > .inline-edit {
  padding: 8px 12px;
  background: var(--vis-soft, var(--accent-soft));
  border-radius: var(--radius);
}

.summary-block > .inline-edit .inline-edit-box {
  border-color: var(--vis-line, var(--accent-line));
}

.summary-block > .link-button {
  background: var(--vis-soft, var(--accent-soft));
  color: var(--vis-ink, var(--accent));
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
body.board-workspace-open .app > .way-bar,
body.board-workspace-open .app > .way-foot,
body.board-workspace-open .feedback-button { display: none; }
body.board-workspace-open .main-content { display: block; padding: 0; }
.infinite-board { position: fixed; inset: 0; z-index: 100; overflow: hidden; background: var(--paper-sunken); font-family: var(--font-serif); }
.board-toolbar { position: absolute; inset: 0 0 auto; min-height: 55px; }
.board-toolbar button { padding: 6px 12px; border-radius: var(--radius); box-shadow: none; font-family: var(--font-ui); font-size: var(--fs-xs); line-height: 1.5; }
/* The way home, drawn as the house the desktop toolbar and the viewer both
   wear, so one glyph means one thing everywhere in Papol. */
/* The way back to where the board is kept, beside the house that leaves for
   Papol. Worded, because unlike the house it names what it returns to. */
.board-toolbar-title { min-width: 100px; border: 1px solid transparent; padding: 6px 8px; background: transparent; color: var(--ink); font: 600 var(--fs-lg) var(--font-serif); }
.board-toolbar-title:focus { outline: none; border-color: var(--accent-line); background: var(--paper); }
.board-toolbar-title[readonly] { cursor: default; }
.board-toolbar-title[readonly]:focus { border-color: transparent; background: transparent; }
/* Stands in the row after the name rather than pinned to the bar's centre:
   pinned there, a long name or a narrow window (a tablet) ran the two into
   each other. It gives way first when the row is short of room. */
.board-toolbar-project { flex: 0 1 auto; min-width: 0; overflow: hidden; padding: 2px var(--space-2); border: 1px solid var(--accent-line); border-radius: var(--radius-pill); background: var(--accent-soft); color: var(--accent); font: 600 var(--fs-2xs) var(--font-ui); text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
.board-toolbar-project:hover { border-color: var(--accent); }
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
/* A group's options: a quiet ⋯ at the end of its heading, shown on hover,
   and once the group is selected a bar just above the heading. Both keep
   their size on screen whatever the zoom, as the card actions do. An empty
   header's prompt waits for the same hover, so an untouched group is only
   its title. */
.board-booklet-heading.has-options .board-booklet-title { padding-right: calc(34px * var(--board-ui-scale)); }
.board-group-more { position: absolute; z-index: 1; top: 50%; right: 2px; display: grid; place-items: center; width: 28px; height: 28px; padding: 4px; border-radius: 50%; color: var(--ink-soft); opacity: 0; translate: 0 -50%; scale: var(--board-ui-scale); transform-origin: right center; pointer-events: auto; transition: opacity var(--motion-fast) var(--ease-out), background-color var(--motion-fast) var(--ease-out); }
.board-group-more > svg, .board-group-options .item-action > svg { display: block; width: 20px; height: 20px; }
.board-group-more .action-glyph, .board-group-options .action-glyph { fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
.board-group-more .action-glyph-fill { fill: currentColor; stroke: none; }
.board-booklet:hover .board-group-more, .board-group-more:focus-visible, .board-group-more[aria-expanded='true'] { opacity: 1; }
.board-group-more:hover:not(:disabled), .board-group-more[aria-expanded='true'] { background: var(--accent-soft); color: var(--accent); }
.board-booklet-header-text.empty:is(button) { opacity: 0; transition: opacity var(--motion-fast) var(--ease-out); }
.board-booklet:hover .board-booklet-header-text.empty, .board-booklet.selected .board-booklet-header-text.empty, .board-booklet-header-text.empty:focus-visible { opacity: 1; }
.board-group-options-anchor { position: absolute; left: 0; top: 0; width: 0; height: 0; }
.board-group-options { position: absolute; right: 0; bottom: calc(6px * var(--board-ui-scale)); scale: var(--board-ui-scale); transform-origin: bottom right; font-family: var(--font-ui); line-height: 1.35; cursor: default; }
.board-group-options.below { top: 40px; bottom: auto; transform-origin: top right; }
.board-group-options-surface { display: flex; align-items: center; gap: 2px; width: max-content; padding: 3px; border-radius: 999px; backdrop-filter: blur(8px); }
.board-group-options-kind { padding: 0 8px 0 11px; color: var(--ink-faint); font: 650 var(--fs-2xs) var(--font-ui); letter-spacing: .045em; text-transform: uppercase; white-space: nowrap; }
.board-group-arrange { display: flex; gap: 2px; margin-right: 3px; padding: 2px; border-radius: 999px; background: color-mix(in srgb, var(--ink) 6%, var(--card)); }
.board-group-arrange button { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 11px 0 8px; border-radius: 999px; color: var(--ink-soft); font: 600 var(--fs-xs) var(--font-ui); white-space: nowrap; }
.board-group-arrange button > svg { width: 17px; height: 17px; }
.board-group-arrange button:hover:not(:disabled) { color: var(--ink); }
.board-group-arrange button[aria-checked='true'] { background: var(--card); color: var(--accent); box-shadow: 0 1px 2px rgba(29,33,41,.14), 0 0 0 1px var(--accent-line); }
.board-group-options-divider { width: 1px; height: 20px; margin: 0 3px; background: var(--line); }
/* A tidy, an arrange or a reset glides what it moves, and then says what
   it did, with the way back, at the foot of the canvas. */
.board-stage.board-gliding .board-canvas-card,
.board-stage.board-gliding .board-booklet { transition: transform 180ms cubic-bezier(.22,.9,.3,1), width 180ms cubic-bezier(.22,.9,.3,1), height 180ms cubic-bezier(.22,.9,.3,1); }
.board-notice { position: fixed; z-index: 45; bottom: 22px; left: 50%; display: flex; align-items: center; gap: 12px; max-width: calc(100vw - 32px); padding: 6px 6px 6px 16px; transform: translateX(-50%); border-radius: var(--radius-pill); color: var(--ink); font: var(--fs-sm) var(--font-ui); animation: board-notice-in 160ms var(--ease-out); }
.board-notice span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.board-notice button { padding: 5px 12px; border-radius: var(--radius-pill); color: var(--accent); font: 600 var(--fs-sm) var(--font-ui); }
.board-notice button:hover:not(:disabled) { background: var(--accent-soft); }
.board-notice:not(:has(button)) { padding-right: 16px; }
@keyframes board-notice-in { from { opacity: 0; transform: translate(-50%, 6px); } }
@media (hover: none) {
  .board-group-more { opacity: 1; }
}
@media (pointer: coarse) {
  .board-group-arrange button { height: 36px; }
}
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
.board-canvas-card.youtube .board-card-kind i,
.board-canvas-card.bilibili .board-card-kind i { padding-left: 1px; font-size: 11px; }
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
.board-canvas-card.youtube .board-image-loading, .board-canvas-card.bilibili .board-image-loading, .board-canvas-card.webpage .board-image-loading { aspect-ratio: 16 / 9; }
.board-link-placeholder { aspect-ratio: 16 / 9; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; background: var(--paper); color: var(--ink-soft); font: var(--fs-sm) var(--font-ui); }
.board-link-placeholder > span:first-child { color: var(--accent); font-size: 24px; }
.board-canvas-card.webpage img,
.board-canvas-card.youtube img,
.board-canvas-card.bilibili img { aspect-ratio: 16 / 9; height: auto; max-height: none; object-fit: cover; background: transparent; }
/* A link card is one size whatever it links to: the picture in the same
   16:9 frame as the placeholder (a page from its top), the title in two
   lines' room. */
.board-canvas-card.webpage img { object-position: top; }
.board-canvas-card:is(.webpage, .youtube, .bilibili) .board-youtube-description {
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere;
  box-sizing: content-box; height: 2lh;
}
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
  .board-canvas-card.booklet-reorder-peer,
  .board-stage.board-gliding .board-canvas-card,
  .board-stage.board-gliding .board-booklet { transition-duration: 0ms; }
  .board-notice { animation: none; }
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
  .board-group-options-kind, .board-group-arrange button > span { display: none; }
  .board-group-arrange button { padding: 0 9px; }
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

  /* A board's name keeps its badge beside it; the pair takes the row. */
  .detail-title-row .board-jacket-heading { flex-basis: 100%; }
  .detail-title-row .board-jacket-heading h2 { flex-basis: auto; }

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

/* Projects: a list of them, one of them, and the link that lets someone in. */
.projects-page,
.project-page {
  max-width: 760px;
}

.projects-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-bottom: var(--space-4);
}

.projects-header h2 {
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

/* The projects list: mine, then everyone else's, each a panel of rows. */
.projects-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-bottom: var(--space-5);
}
.projects-head h2 { font-size: var(--fs-2xl); }
.projects-head .experimental-badge { margin-right: auto; }
.project-title-row .experimental-badge, .project-toolbar .experimental-badge { flex: none; }
.projects-kicker { margin: var(--space-5) 0 var(--space-2); }
.projects-head + .projects-kicker { margin-top: 0; }
.projects-panel { padding: 0 var(--space-4); margin-bottom: 0; }
/* In the Bazaar, the projects are a section above everyone's papers. */
.projects-page.is-section { max-width: none; margin-bottom: var(--space-5); }
/* Papers come in through the nook; the Bazaar shows no drop box. A PDF
   dropped anywhere on the window still lands here for its review. */
.library-page.is-bazaar > .upload-section { display: none; }
.projects-page.is-section .projects-head { margin-bottom: var(--space-3); }
.projects-page.is-section .projects-head h3 { margin: 0; font-size: var(--fs-lg); }
.projects-page.is-section .projects-row { padding-block: var(--space-3); }
.projects-list { list-style: none; margin: 0; padding: 0; }

.projects-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin: 0 calc(-1 * var(--space-4));
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--line);
  transition: background var(--motion-fast) var(--ease-out);
}
.projects-row:last-child { border-bottom: none; }
.projects-row:not(.closed):hover { background: var(--paper-sunken); }
.projects-row-text {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-2);
  flex: 1;
  min-width: 0;
}
.projects-row-name {
  font-size: var(--fs-lg);
  font-weight: 600;
  line-height: 1.3;
  color: var(--ink);
  text-decoration: none;
  overflow-wrap: anywhere;
}
/* The whole row opens the project; the faces stay their own links above it. */
a.projects-row-name::after { content: ''; position: absolute; inset: 0; }
a.projects-row-name:hover { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
.projects-row .badge { align-self: center; }
.projects-row.closed .projects-row-name { color: var(--ink-soft); font-weight: 400; }
.projects-row-note {
  flex-basis: 100%;
  color: var(--ink-faint);
  font-size: var(--fs-sm);
  font-style: italic;
}

.projects-crowd {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex: none;
}
.projects-crowd .project-members { flex-wrap: nowrap; }
.projects-crowd .mini-avatar { width: var(--space-6); height: var(--space-6); font-size: var(--fs-xs); }
.projects-more { color: var(--ink-faint); font: var(--fs-xs) var(--font-ui); font-variant-numeric: tabular-nums; }

.projects-create {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-4) 0;
  border-bottom: 1px solid var(--line);
}
.projects-create:last-child { border-bottom: none; }
.projects-create input {
  flex: 1 1 auto;
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--card);
}
.projects-create input:focus { outline: 0; border-color: var(--accent); box-shadow: 0 0 0 2px var(--focus-soft); }
.projects-empty { margin: 0; padding: var(--space-5) 0; color: var(--ink-faint); font-size: var(--fs-md); font-style: italic; }

@media (max-width: 640px) {
  .projects-row { flex-wrap: wrap; row-gap: var(--space-2); }
  .projects-row-text { flex-basis: 100%; }
  .projects-create { flex-wrap: wrap; }
  .projects-create input { flex-basis: 100%; }
}

/* SHARED (optional; affects the project and invitation pages too): a keeper
   holds a role, and gold is Papol's hue for that, as on a paper's author. */
.avatar-chip.project-keeper { border-color: var(--gold); background: var(--gold-soft); }
.project-keeper .mini-avatar { box-shadow: none; }

.project-new {
  background: var(--accent);
  color: var(--ink-inverse);
}

.project-members {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

/* One project: a calm single column. Rows sit on the page; only the
   selected paper rises into a card. */
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.project-title { margin: 0; font-size: var(--fs-2xl); line-height: 1.2; }
.project-title-input { width: 100%; margin-left: calc(-1 * var(--space-2)); padding: 0 var(--space-2); border: 1px solid transparent; border-radius: var(--radius); background: transparent; color: var(--ink); font: inherit; transition: border-color var(--motion-fast) var(--ease-out), background-color var(--motion-fast) var(--ease-out); }
.project-title-input:hover { border-color: var(--line); background: var(--card); }
.project-title-input:focus { border-color: var(--accent); background: var(--card); box-shadow: 0 0 0 2px var(--focus-soft); outline: 0; }

/* A face that leads to its person's nook. */
.face-link { display: inline-flex; flex: none; border-radius: 50%; text-decoration: none; }
.face-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* The members, as overlapping faces and a count; one control. */
.project-faces { display: inline-flex; align-items: center; padding-left: var(--space-1); }
.project-faces .mini-avatar { margin-left: calc(-1 * var(--space-1)); box-shadow: 0 0 0 2px var(--paper); }
.project-faces-more { margin-left: var(--space-1); color: var(--ink-faint); font: var(--fs-2xs) var(--font-ui); }
.project-crowd { display: inline-flex; align-items: center; gap: var(--space-2); margin: var(--space-2) 0 0 calc(-1 * var(--space-2)); padding: var(--space-1) var(--space-2); color: var(--ink-soft); font: var(--fs-sm) var(--font-ui); }
button.project-crowd { border-color: transparent; background: none; box-shadow: none; }
button.project-crowd:hover:not(:disabled), button.project-crowd[aria-expanded='true'] { border-color: transparent; background: var(--fill); color: var(--ink); }
button.project-crowd:hover .project-faces .mini-avatar, button.project-crowd[aria-expanded='true'] .project-faces .mini-avatar { box-shadow: 0 0 0 2px var(--fill); }

button.project-quiet { padding: var(--space-1) var(--space-2); border-color: transparent; background: none; box-shadow: none; color: var(--ink-soft); font-size: var(--fs-sm); }
button.project-quiet:hover:not(:disabled) { border-color: transparent; background: var(--accent-soft); color: var(--accent); }
button.project-quiet.project-danger { color: var(--red); }
button.project-quiet.project-danger:hover:not(:disabled) { background: var(--red-soft); color: var(--red); }

/* Members panel: flat, between two hairlines. */
.project-people { position: absolute; z-index: 300; top: calc(100% + var(--space-1)); right: 0; width: min(380px, calc(100vw - 2 * var(--space-4))); padding: var(--space-3) var(--space-4); border: 1px solid var(--line-strong); border-radius: var(--radius-lg); background: var(--card); box-shadow: var(--shadow-md); font: var(--fs-sm) var(--font-ui); text-align: left; cursor: auto; }
.desktop-toolbar .project-people { top: calc(100% + var(--space-2)); }
.project-people button:not(.project-quiet) { padding: var(--space-1) var(--space-3); font-size: var(--fs-xs); }
.project-invite { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); margin-bottom: var(--space-4); }
.project-invite-note { color: var(--ink-faint); font-size: var(--fs-xs); }
.project-invite:last-child { margin-bottom: 0; }
.project-invite-link + button + button + .project-invite-note { flex-basis: 100%; }
.project-invite-link { flex: 1 1 10rem; min-width: 0; overflow: hidden; padding: var(--space-1) var(--space-2); border-radius: var(--radius); background: var(--paper-sunken); color: var(--ink-soft); font: var(--fs-xs) var(--font-mono); text-overflow: ellipsis; white-space: nowrap; user-select: all; }
.project-people-list { margin: 0; padding: 0; list-style: none; }
.project-person { display: flex; align-items: center; gap: var(--space-2); min-height: 36px; }
.project-person-name { color: var(--ink); text-decoration: none; }
.project-person-name:hover { color: var(--accent); }
.project-person-role { color: var(--ink-faint); font-size: var(--fs-xs); }
.project-person-actions { display: flex; gap: var(--space-1); margin-left: auto; opacity: 0; transition: opacity var(--motion-fast) var(--ease-out); }
.project-people .project-person-name { font-weight: 500; }
.project-person:hover .project-person-actions,
.project-person:focus-within .project-person-actions { opacity: 1; }
@media (hover: none) { .project-person-actions { opacity: 1; } }

.project-closed { margin: 0; color: var(--ink-soft); font-size: var(--fs-md); }

/* Sections: a serif word and a faint count; no small caps, no boxes. */
.project-section + .project-section { margin-top: var(--space-7); }

/* The desk: papers and boards as cards, with what is being said in a
   column beside them once the page is wide enough. Cards share a board
   card's anatomy: a header strip with an uppercase kind, a serif title. */
.app[data-page='project']:has(.project-page.is-desk) { max-width: 1180px; }
.desktop-content:has(.project-page.is-desk) { max-width: none; }
.project-page.is-desk { max-width: none; container-type: inline-size; }
/* The pages inside a project fill the window: no masthead, no measure. */
.app.is-project { max-width: none; padding: var(--space-4) var(--space-5) var(--space-7); }
@media (max-width: 640px) { .app.is-project { padding: var(--space-3) var(--space-4) var(--space-7); } }

.project-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3) var(--space-5); margin-bottom: var(--space-4); }
.project-head-main { flex: 1 1 22rem; min-width: 0; }
.is-desk .project-title { font: 600 var(--fs-hero)/1.15 var(--font-serif); }
.project-title-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-2); min-width: 0; }
.project-title-row .project-title { min-width: 0; }
/* The name input takes its text's width: a hidden copy of the name sizes
   the cell both share. */
.project-title-sizer { display: inline-grid; max-width: 100%; }
.project-title-sizer::after { content: attr(data-value) ' '; visibility: hidden; white-space: pre; overflow: hidden; padding: 0 var(--space-2); border: 1px solid transparent; }
.project-title-sizer::after, .project-title-sizer > .project-title-input { grid-area: 1 / 1; min-width: 0; }
.project-title-sizer > .project-title-input { text-overflow: ellipsis; }
.project-tally { margin: var(--space-2) 0 0; color: var(--ink-faint); font: var(--fs-sm) var(--font-ui); }

.project-seats { position: relative; display: flex; align-items: flex-start; gap: var(--space-2); }
.project-seat-row { display: flex; gap: var(--space-2); padding: var(--space-1); border-color: transparent; background: none; box-shadow: none; }
.project-seat-row:hover:not(:disabled), .project-seat-row[aria-expanded='true'] { border-color: transparent; background: var(--fill); }
.project-seat { display: grid; justify-items: center; gap: 2px; width: 44px; }
.project-seat .mini-avatar { width: 28px; height: 28px; font-size: var(--fs-xs); }
.project-seat small { max-width: 100%; overflow: hidden; color: var(--ink-faint); font: var(--fs-2xs) var(--font-ui); text-overflow: ellipsis; white-space: nowrap; }
.project-seat-more { align-self: center; color: var(--ink-faint); font: var(--fs-xs) var(--font-ui); }
/* Quiet at rest: the header's only emphasis is what is new. */
.project-invite-open, .project-board-start { display: inline-flex; align-items: center; gap: var(--space-1); padding: var(--space-1) var(--space-3); border-color: transparent; background: none; box-shadow: none; color: var(--ink-soft); font: 500 var(--fs-sm) var(--font-ui); }
.project-invite-open { align-self: center; }
.project-board-start { margin-left: auto; }
.project-invite-open:hover:not(:disabled), .project-board-start:hover:not(:disabled), .project-invite-open:focus-visible, .project-board-start:focus-visible { background: var(--accent-soft); color: var(--accent); }
.project-invite-open .action-glyph, .project-board-start .action-glyph, .project-board-add .action-glyph { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
.is-desk .project-people { max-width: 36rem; margin: 0 0 var(--space-6); padding: var(--space-2) var(--space-4); border: 1px solid var(--line-strong); border-radius: var(--radius-lg); background: var(--card); }

.project-desk { min-width: 0; margin-top: var(--space-4); }
[data-shell='desktop'] .project-desk { margin-top: 0; }
/* The desk's three views: quiet words, the one shown on a soft pill. */
.project-tabs { display: flex; align-items: center; gap: var(--space-1); margin-top: var(--space-2); }
.project-tab { position: relative; display: inline-flex; align-items: center; gap: 6px; padding: 5px var(--space-3); border: 1px solid transparent; border-radius: 999px; background: none; box-shadow: none; color: var(--ink-soft); font: 500 var(--fs-sm) var(--font-ui); }
.project-tab:hover:not(:disabled) { border-color: transparent; background: color-mix(in srgb, var(--ink) 6%, transparent); color: var(--ink); }
.project-tab.is-on, .project-tab.is-on:hover:not(:disabled) { border-color: var(--line); background: var(--card); color: var(--ink); box-shadow: var(--shadow-sm); }
.project-tab-count { position: relative; top: 1px; color: var(--ink-faint); font: var(--fs-xs) var(--font-ui); font-variant-numeric: tabular-nums; }
/* New items on a tab: a number alone. Unread posts on an item are the spade pill (.project-card-alert). */
.project-tab-new { display: inline-block; box-sizing: border-box; height: 18px; min-width: 18px; padding: 0 5px; text-align: center; font-variant-numeric: tabular-nums; border: 1px solid var(--gold-line); border-radius: 999px; background: var(--gold-soft); color: var(--gold-ink); font: 700 var(--fs-2xs)/19px var(--font-ui); }
.project-section-actions { display: flex; justify-content: flex-end; margin-bottom: var(--space-3); }
/* Papers as rows: a bibliography with the project's facts beside each entry.
   No rules between them: each row is a soft tile that shows only on hover,
   when new, or when open, where it takes the pane's white. */
.project-rows { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
.project-row { display: grid; grid-template-columns: minmax(0, 1fr) 190px 170px 96px; column-gap: var(--space-3); align-items: center; padding: var(--space-3); border-radius: var(--radius-lg); cursor: pointer; transition: background-color var(--motion-fast) var(--ease-out); }
.project-row:hover { background: color-mix(in srgb, var(--ink) 4%, transparent); }
.project-row.is-new { background: var(--gold-soft); }
.project-row.is-new:hover { background: color-mix(in srgb, var(--gold-soft) 88%, var(--ink)); }
.project-row-text { min-width: 0; }
.project-row .project-card-title { display: block; font-size: var(--fs-base); -webkit-line-clamp: unset; }
.project-row:hover .project-card-title, .project-row:focus-within .project-card-title { color: var(--accent); }
.project-row .project-card-authors { margin-top: 1px; font-size: var(--fs-sm); }
.project-row-cite { display: -webkit-box; overflow: hidden; color: var(--ink-soft); font: var(--fs-sm)/1.3 var(--font-ui); -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.project-row-facts { display: contents; }
.project-row .project-card-added { margin: 0; padding: 0; white-space: nowrap; }
.project-row-end { display: inline-flex; align-items: center; justify-content: flex-end; gap: var(--space-2); }
.project-row .project-card-alert { margin-left: 0; }
@container (max-width: 1099px) {
  .project-row { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'text end' 'facts end'; row-gap: 2px; column-gap: var(--space-3); }
  /* The facts share one line and one left edge whatever a row lacks. */
  .project-row-facts { display: flex; flex-wrap: wrap; align-items: center; gap: 2px var(--space-3); grid-area: facts; font-size: var(--fs-xs); }
  .project-row-text { grid-area: text; }
  .project-row-end { grid-area: end; }
  .project-row-cite { display: block; font-size: var(--fs-xs); white-space: nowrap; }
  .project-row-cite:empty { display: none; }
}
@container (max-width: 559px) {
  .project-row-cite { display: none; }
}
.project-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr)); align-items: stretch; gap: var(--space-4); margin: 0; padding: 0; list-style: none; }
.project-card { position: relative; display: flex; flex-direction: column; min-width: 0; border: 1px solid var(--line-strong); border-radius: 10px; background: var(--card); box-shadow: var(--shadow-sm); transition: border-color var(--motion-fast) var(--ease-out); }
.project-card:hover { border-color: var(--accent); }
.project-paper { cursor: pointer; }
.project-paper:focus-within:has(.project-card-title a:focus-visible) { border-color: var(--accent); }
.project-card-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-height: 36px; padding: 5px 8px 5px 12px; border-bottom: 1px solid var(--line); border-radius: 9px 9px 0 0; background: color-mix(in srgb, var(--paper) 72%, var(--card)); }
.project-paper.is-new .project-card-head { border-bottom-color: var(--gold-line); background: var(--gold-soft); }
.project-card-kind { display: inline-flex; align-items: center; color: var(--ink-faint); font: 650 var(--fs-2xs) var(--font-ui); letter-spacing: .045em; text-transform: uppercase; }
.project-card-head .project-card-new { margin-left: auto; }
.project-card-new { color: var(--gold-ink); font: 700 var(--fs-2xs) var(--font-ui); letter-spacing: .045em; text-transform: uppercase; }
.project-card-body { display: flex; flex: 1 1 auto; flex-direction: column; gap: var(--space-1); padding: var(--space-3) var(--space-3) var(--space-2); }
.project-card-title { display: -webkit-box; margin: 0; overflow: hidden; color: var(--ink); font: 600 var(--fs-md)/1.35 var(--font-serif); -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
.project-card-title a { color: inherit; }
.project-card-authors { margin: 0; overflow: hidden; color: var(--ink-soft); font: italic var(--fs-sm) var(--font-serif); text-overflow: ellipsis; white-space: nowrap; }
.project-card-alert { display: inline-flex; flex: none; align-items: center; gap: 3px; height: 22px; margin-left: auto; padding: 0 7px 0 5px; border: 1px solid var(--gold-line); border-radius: 999px; background: var(--gold-soft); box-shadow: none; color: var(--gold-ink); font: 700 var(--fs-2xs) var(--font-ui); }
.project-card-new + .project-card-alert { margin-left: var(--space-1); }
.project-card-alert:hover:not(:disabled), .project-card-alert[aria-expanded='true'] { border-color: var(--gold); background: var(--gold-soft); color: var(--gold-ink); }
.project-card-alert .talk-glyph { width: 14px; height: 14px; }
.project-card-added { margin: var(--space-2) 0 0; color: var(--ink-faint); font: var(--fs-xs) var(--font-ui); }
.project-board-map { display: block; width: 100%; height: 96px; margin-bottom: var(--space-2); border-radius: 6px; background: var(--paper); }
.project-board-map rect { fill: var(--card); stroke: var(--line-strong); stroke-width: 1; vector-effect: non-scaling-stroke; }
.project-card-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-1) var(--space-2) var(--space-2); }
.project-paper-added { margin: 0; color: var(--ink-faint); font: var(--fs-xs) var(--font-ui); }
.project-board-tile { display: grid; min-height: 160px; }
.project-board-add { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-1); width: 100%; min-height: 96px; padding: var(--space-4); border: 1px dashed var(--line-strong); border-radius: 10px; background: none; box-shadow: none; color: var(--ink-soft); font: var(--fs-sm) var(--font-ui); text-align: center; }
.project-paper-empty span, .project-board-add span { color: var(--ink-faint); font-size: var(--fs-xs); font-weight: 400; }
.project-board-add { font-weight: 500; }
.project-board-add:hover:not(:disabled), .project-board-add:focus-visible { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }

.project-board-name { min-width: 0; min-height: 36px; padding: var(--space-1) var(--space-3); border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--paper); font: var(--fs-md) var(--font-serif); transition: border-color var(--motion-fast) var(--ease-out); }
.project-board-name:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); outline: 0; }

.project-board-link { color: inherit; text-decoration: none; }
/* The whole card opens the board; the alert stays its own button above it. */
.project-board .project-board-link::after { content: ''; position: absolute; inset: 0; }
.project-board > .project-card-alert { position: absolute; top: var(--space-2); right: var(--space-2); z-index: 1; margin: 0; }

.project-board-link:hover .project-card-title { color: var(--accent); }
.project-board-meta { justify-content: flex-start; margin-top: auto; padding: var(--space-1) var(--space-3) var(--space-2); color: var(--ink-faint); font: var(--fs-xs) var(--font-ui); }
.project-boards { grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr)); }
.project-board.is-naming { border-color: var(--accent); }
.project-board-name { font-weight: 600; }
.project-board-form-actions { display: flex; justify-content: flex-end; gap: var(--space-2); margin-top: auto; padding-top: var(--space-2); }

/* Digs as rows, the soft tiles of the Papers tab; a dig opens beside its
   row on a wide window, under it on a narrow one. */
.project-talk-list { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; margin: 0; padding: 0; list-style: none; }
/* Wide: the list stays put and the dig opens beside it. */
.project-talk.is-wide { display: grid; grid-template-columns: minmax(360px, 460px) minmax(420px, 1fr); column-gap: var(--space-6); align-items: start; }
.project-talk-phase { flex: none; margin-left: 6px; padding: 0 6px; border: 1px solid var(--line); border-radius: 999px; color: var(--ink-soft); letter-spacing: 0; text-transform: none; }
.project-talk-phase.is-gold { border-color: var(--accent); color: var(--accent-strong); }
.project-talk-item.is-buried .project-talk-label { color: var(--ink-faint); }
.project-talk .project-talk-item:hover:not(:disabled) { background: color-mix(in srgb, var(--ink) 4%, transparent); }
.project-talk .project-talk-item.is-new, .project-talk .project-talk-item.is-new:hover:not(:disabled) { background: var(--gold-soft); }
.project-talk .project-talk-item.is-selected, .project-talk .project-talk-item.is-selected:hover:not(:disabled) { background: var(--card); box-shadow: var(--shadow-sm); }
.project-talk .project-talk-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
/* The open thing sits on white, the list on the page: tone, not a rule, parts them. */
.project-talk-panel { position: sticky; top: var(--space-4); padding: var(--space-2) var(--space-5) 0; border-radius: var(--radius-lg); background: var(--card); box-shadow: var(--shadow-sm); }
/* One scroller: the page. The pane stays put beside a long list and
   scrolls with the page when it is the longer one. */
.project-talk:not(.is-wide) .project-talk-panel { position: static; margin: var(--space-1) 0 var(--space-3); padding-inline: var(--space-4); }
.project-talk-panel .talk-card.is-inline { border: 0; border-radius: 0; background: none; box-shadow: none; max-height: none; overflow: visible; }
.project-talk-panel .talk-card.is-inline .talk-card-body { overflow: visible; }
.project-talk-panel .talk-card.is-inline .talk-card-header { padding-left: 0; background: none; }
.project-talk-panel .talk-card.is-inline :is(.talk-card-owners, .talk-card-body) { padding-left: 0; padding-right: 0; }
.project-talk-panel .talk-post { margin-inline: 0; padding-inline: 0; }
.project-talk-panel .talk-card.is-inline .talk-compose { position: sticky; bottom: 0; z-index: 1; padding-left: 0; padding-right: 0; background: var(--card); }
.project-talk-subject-line { display: flex; align-items: baseline; gap: var(--space-2); margin: 0 0 var(--space-1); padding-top: 5px; font: 600 var(--fs-md)/1.35 var(--font-serif); }
.project-talk-subject-line a { color: inherit; }
.project-talk-subject-line a:hover { color: var(--accent); }
.project-talk-subject-open { display: inline; width: auto; min-height: 0; padding: 0; border: 0; background: none; box-shadow: none; color: inherit; font: inherit; text-align: left; text-decoration: underline; text-decoration-color: var(--line-strong); text-underline-offset: 3px; }
.project-talk-subject-open:hover:not(:disabled) { border: 0; background: none; color: var(--accent); }
.project-talk-item .project-card-alert { margin-left: auto; }
.project-talk-list > li { display: grid; }
.project-talk-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-1) var(--space-2); width: 100%; padding: var(--space-3); border: 0; border-radius: var(--radius-lg); background: none; box-shadow: none; color: var(--ink); font: inherit; text-align: left; transition: background-color var(--motion-fast) var(--ease-out); }
.project-talk-subject { display: flex; align-items: center; gap: var(--space-2); min-width: 0; grid-column: 1; }
.project-talk-subject > .project-card-kind { flex: none; white-space: nowrap; }
.project-talk-meta { grid-column: 1; }
.project-talk-item > .project-card-alert { grid-column: 2; grid-row: 1 / span 2; align-self: center; }
.project-talk-label { overflow: hidden; color: var(--ink-soft); font: italic var(--fs-xs) var(--font-serif); text-overflow: ellipsis; white-space: nowrap; }
.project-talk-meta { display: flex; align-items: center; gap: var(--space-1); color: var(--ink-faint); font: var(--fs-xs) var(--font-ui); }
.project-talk-meta b { color: var(--ink-soft); font-weight: 600; }
@container (max-width: 559px) {
  .project-head { align-items: flex-start; }
  .project-seat small { display: none; }
  .project-seat { width: auto; }
  .project-boards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

${talkStyles}
.board-card-talk { margin-left: auto; }
.board-card-talk + .board-card-action-menu { margin-left: var(--space-1); }
.board-toolbar .talk-pin { padding: 0; }

/* The Papers tab: the list, and the picked paper's brief beside it on a
   wide window, laid out as the Digs tab lays out a dig. */
.project-papers-view.is-wide { display: grid; grid-template-columns: minmax(340px, 440px) minmax(420px, 1fr); column-gap: var(--space-6); align-items: start; }
/* The list reads its own width, so its rows fold as they do on a phone. */
.project-papers-view.is-wide .project-papers { container-type: inline-size; }
.project-row-open { display: inline; width: auto; min-height: 0; padding: 0; border: 0; background: none; box-shadow: none; color: inherit; font: inherit; text-align: left; }
.project-row-open:hover:not(:disabled) { border: 0; background: none; color: inherit; }
.project-row.is-selected, .project-row.is-selected:hover { background: var(--card); box-shadow: var(--shadow-sm); }
.project-row.is-selected .project-card-title { color: var(--ink); }
.project-papers-panel { position: sticky; top: var(--space-4); padding: var(--space-5) var(--space-5) 0; border-radius: var(--radius-lg); background: var(--card); box-shadow: var(--shadow-sm); }
.project-paper-open { margin-bottom: var(--space-3); padding: var(--space-4) var(--space-3) var(--space-5); border-radius: var(--radius-lg); background: var(--card); box-shadow: var(--shadow-sm); }


/* A paper's brief: the paper, the ways to act on it, the members' takes,
   then its dig, in one reading column. */
.paper-brief { display: grid; gap: var(--space-4); max-width: 44rem; }
.paper-brief-head { display: grid; gap: var(--space-2); }
.paper-brief-title { margin: 0; font: 600 var(--fs-xl)/1.3 var(--font-serif); text-wrap: balance; }
.paper-brief-cite { display: flex; flex-wrap: wrap; gap: 0 var(--space-3); margin: 0; color: var(--ink-soft); font: var(--fs-sm) var(--font-ui); }
.paper-brief-authors { font: italic var(--fs-md) var(--font-serif); }
.paper-brief-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-4); margin-top: var(--space-2); }
.paper-brief-actions .button { font-family: var(--font-ui); }
.paper-brief-quiet { display: inline-flex; align-items: center; min-height: 0; padding: 0; border: 0; background: none; box-shadow: none; color: var(--ink-soft); font: var(--fs-sm) var(--font-ui); }
.paper-brief-quiet:hover:not(:disabled) { border: 0; background: none; color: var(--accent); }
.paper-brief-quiet .action-glyph { width: 16px; height: 16px; margin-right: var(--space-1); fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.paper-brief-take-out { margin-left: auto; }
.paper-brief-take-out:hover:not(:disabled) { color: var(--red); }
.paper-brief .project-paper-added { margin-top: calc(-1 * var(--space-2)); }
.paper-brief-dig { padding-top: var(--space-4); }
.paper-brief-dig .talk-card.is-inline { border: 0; border-radius: 0; background: none; box-shadow: none; max-height: none; overflow: visible; }
.paper-brief-dig .talk-card.is-inline .talk-card-body { overflow: visible; padding-left: 0; padding-right: 0; }
.paper-brief-dig .talk-card.is-inline .talk-card-header { min-height: 0; padding: 0 0 var(--space-2); border-bottom: 0; background: none; align-items: baseline; }
.paper-brief-dig .talk-card.is-inline .talk-card-subject { padding-left: 0; }
.paper-brief-dig .talk-card.is-inline .talk-card-owners { padding-left: 0; padding-right: 0; }
/* Posts are read, not skimmed: body size and leading, parted by space. */
.paper-brief-dig .talk-post { padding: var(--space-3) 0; }
.paper-brief-dig .talk-post-head { margin-bottom: var(--space-1); }
.paper-brief-dig .talk-post-head .mini-avatar { width: 22px; height: 22px; font-size: 11px; }
.paper-brief-dig .talk-post-body { font-size: var(--fs-md); line-height: 1.5; }
.paper-brief-dig .talk-post-body :is(p, ol, ul) { margin-bottom: .5em; }
.paper-brief-dig .talk-compose { padding-left: 0; padding-right: 0; }
.paper-brief-dig .talk-compose textarea { background: var(--card); }
.paper-brief-dig .talk-card.is-inline .talk-card-error { margin-left: 0; }
/* Beside the list, the reply bar stays at the foot of the pane. */
.project-papers-panel .paper-brief-dig .talk-compose { position: sticky; bottom: 0; z-index: 1; margin-inline: calc(-1 * var(--space-3)); padding-inline: var(--space-3); background: var(--card); }

/* In the Mac app a project's pages keep their header in the window's
   toolbar: the desk's name, its three views in the middle and its people. */
.project-toolbar { display: flex; flex: 1 1 0; align-items: center; gap: var(--space-2); min-width: 0; }
.project-toolbar .project-title { flex: 0 1 auto; max-width: 100%; margin: 0; font: 600 var(--fs-base)/1.3 var(--font-ui); }
.desktop-toolbar .project-tabs { flex: none; margin: 0; }
.desktop-toolbar .project-tab { padding: 3px var(--space-3); }
.desktop-toolbar .project-seats { flex: 1 1 0; justify-content: flex-end; align-items: center; gap: var(--space-1); }
.desktop-toolbar .project-seat-row { gap: 0; padding: 2px; }
.desktop-toolbar .project-seat { width: auto; margin-left: -4px; }
.desktop-toolbar .project-seat:first-child { margin-left: 0; }
.desktop-toolbar .project-seat .mini-avatar { width: 24px; height: 24px; box-shadow: 0 0 0 2px var(--paper); }
.desktop-toolbar .project-seat small { display: none; }
.desktop-toolbar .project-invite-open { padding: 2px var(--space-2); }

.project-invitation {
  display: flex;
  justify-content: center;
  padding-top: 6vh;
}

.project-invitation-card {
  width: 100%;
  max-width: 400px;
  padding: var(--space-6) var(--space-5);
}

.project-invitation-card h2 {
  margin: 0 0 var(--space-1);
  font-size: var(--fs-2xl);
  overflow-wrap: anywhere;
}

.project-invitation-meta {
  margin: 0 0 var(--space-3);
}

.project-invitation .project-members {
  gap: var(--space-2);
}

.project-invitation .mini-avatar {
  width: 28px;
  height: 28px;
  font-size: var(--fs-xs);
}

.project-invitation-note {
  margin: var(--space-4) 0;
  font-size: var(--fs-sm);
  line-height: 1.45;
}

.project-picker { width: 290px; }
.project-picker .share-menu-heading { margin-top: var(--space-1); margin-bottom: var(--space-1); }
.project-picker-why { margin-bottom: var(--space-2); padding-bottom: var(--space-2); border-bottom: 1px solid var(--line); }
.project-picker-why input { display: block; width: 100%; margin-top: var(--space-1); padding: 6px 7px; font-size: var(--fs-xs); }
.project-picker-why .share-note { margin-bottom: 0; }
.project-picker-wait { padding: var(--space-2) 3px; font-size: var(--fs-xs); }
.paper-actions .project-picker > .project-picker-item {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: var(--space-3); align-items: center;
}
.project-picker-item strong { overflow: hidden; font-size: var(--fs-sm); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.paper-actions .project-picker .project-picker-meta { grid-column: 1; margin-top: 1px; }
.paper-actions .project-picker .project-picker-state {
  grid-column: 2; grid-row: 1 / span 2; margin: 0; color: var(--accent); font-size: var(--fs-xs); font-weight: 600;
}
.paper-actions .project-picker .project-picker-state.is-busy { color: var(--ink-faint); font-weight: 400; }
.paper-actions .project-picker .project-picker-state.is-added { color: var(--green-ink); }
.paper-actions .project-picker > .project-picker-item.is-added { cursor: default; }
.paper-actions .project-picker > .project-picker-item.is-added:hover { background: transparent; }

.nook-projects { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); margin-top: var(--space-4); }
.nook-projects-label { margin: 0; }
.nook-projects-list { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
.nook-projects-chip {
  display: inline-flex; align-items: center; gap: var(--space-2); min-height: 30px; padding: 3px var(--space-3);
  border: 1px solid var(--line); border-radius: var(--radius-pill); background: var(--card);
  color: var(--ink); font: var(--fs-sm) var(--font-ui); text-decoration: none;
  transition: border-color var(--motion-fast) var(--ease-out), background-color var(--motion-fast) var(--ease-out);
}
.nook-projects-chip:hover, .nook-projects-chip:focus-visible { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.nook-projects-name { max-width: 16rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nook-projects-faces { display: inline-flex; align-items: center; margin-right: calc(-1 * var(--space-1)); }
.nook-projects-avatar { width: 20px; height: 20px; margin-left: calc(-1 * var(--space-1)); border: 1.5px solid var(--card); font-size: var(--fs-2xs); }
.nook-projects-more { margin-left: var(--space-1); color: var(--ink-faint); font-size: var(--fs-2xs); }
.upload-review-mode .nook-projects,
.upload-review-mode .nook-desk-projects { display: none; }

/* A member's own projects on their nook: cards in a row under the header,
   the first thing after who they are. A project with something new wears
   the gold of new things. */
.nook-desk-projects { margin-top: var(--space-5); }
.nook-desk-projects-title { margin: 0 0 var(--space-3); color: var(--ink); font: 600 var(--fs-lg) var(--font-serif); }
.nook-desk-projects-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr)); gap: var(--space-3); margin: 0; padding: 0; list-style: none; }
.nook-project-card {
  display: flex; flex-direction: column; justify-content: space-between; gap: var(--space-3); height: 100%; box-sizing: border-box;
  padding: var(--space-3) var(--space-4); border: 1px solid var(--line); border-radius: var(--radius); background: var(--card);
  color: var(--ink); text-decoration: none;
  transition: border-color var(--motion-fast) var(--ease-out);
}
.nook-project-card:hover, .nook-project-card:focus-visible { border-color: var(--accent); }
.nook-project-card.has-new { border-color: var(--gold-line); background: var(--gold-soft); }
.nook-project-card-name { font: 600 var(--fs-md) var(--font-serif); line-height: 1.3; }
.nook-project-card-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.nook-project-card-new { color: var(--gold-ink); font: 600 var(--fs-xs) var(--font-ui); }

/* A member's own nook on the web: a rail of places (projects, shelves,
   boards), each opening in the main area beside it. One row grid and one
   left edge throughout; the only fill is the soft accent of the place
   being shown, and what is new says so in gold words, not paint. */
.app:has(.nook.is-desk) { max-width: 1180px; }
/* Someone else's nook: who they are, then a plain list of what they keep. */
.their-nook { max-width: 46rem; }
.their-head { display: flex; align-items: center; gap: var(--space-3); margin: var(--space-2) 0 var(--space-6); }
.their-face { flex: none; width: 48px; height: 48px; font-size: var(--fs-lg); }
.their-name { margin: 0; font: 600 var(--fs-xl)/1.2 var(--font-serif); }
.their-line { margin: 2px 0 0; color: var(--ink-faint); font: 400 var(--fs-sm) var(--font-ui); }
.their-line a { color: inherit; }
.their-list { margin: 0; padding: 0; list-style: none; }
.their-list li { padding: var(--space-3) 0; border-bottom: 1px solid var(--line); }
.their-list li:last-child { border-bottom: 0; }
.their-boards { margin-top: var(--space-6); }
.their-title { display: block; color: var(--ink); font: 400 var(--fs-md)/1.35 var(--font-serif); text-decoration: none; }
.their-title:hover, .their-title:focus-visible { color: var(--accent); text-decoration: underline; }
.their-meta { display: block; margin-top: 2px; color: var(--ink-faint); font: 400 var(--fs-xs) var(--font-ui); }
.their-meta i { font-family: var(--font-serif); }
.their-thought { display: block; margin-top: 4px; color: var(--ink-soft); font: italic 400 var(--fs-sm)/1.4 var(--font-serif); }
.nook-desk { display: grid; grid-template-columns: 15rem minmax(0, 1fr); gap: var(--space-6); align-items: start; }
.desk-rail { position: sticky; top: var(--space-4); }
.desk-rail-body { display: grid; gap: var(--space-5); }
.desk-rail-part { display: grid; gap: var(--space-1); }
.desk-rail-head { display: flex; align-items: center; justify-content: space-between; min-height: 28px; margin: 0; padding: 0 var(--space-2); color: var(--ink-faint); font: 600 var(--fs-2xs) var(--font-ui); letter-spacing: .08em; text-transform: uppercase; }
.desk-rail-head h3 { margin: 0; font: inherit; color: inherit; }
.desk-quiet { padding: 0; border: 0; background: none; box-shadow: none; color: var(--ink-faint); font: 400 var(--fs-xs) var(--font-ui); letter-spacing: 0; text-transform: none; }
.desk-quiet:hover, .desk-quiet:focus-visible { color: var(--accent); background: none; }
.desk-rail-list { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
.desk-row {
  display: flex; align-items: center; gap: var(--space-2); width: 100%; min-height: 32px; box-sizing: border-box;
  padding: 0 var(--space-2); border: 0; border-radius: var(--radius); background: transparent; box-shadow: none;
  color: var(--ink); font: 400 var(--fs-sm) var(--font-ui); text-align: left; text-decoration: none;
}
.desk-row:hover, .desk-row:focus-visible { background: var(--paper-sunken); color: var(--ink); }
.desk-row.is-on { background: var(--accent-soft); font-weight: 600; }
.desk-row-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.desk-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--line-strong); }
.desk-lock { flex: none; width: 12px; height: 12px; fill: none; stroke: var(--ink-faint); stroke-width: 1.4; }
.desk-count { color: var(--ink-faint); font: 400 var(--fs-xs) var(--font-ui); font-variant-numeric: tabular-nums; }
.desk-project {
  display: grid; gap: var(--space-1); padding: var(--space-2); border: 1px solid transparent; border-radius: var(--radius);
  color: var(--ink); text-decoration: none;
}
.desk-project:hover, .desk-project:focus-visible { background: var(--paper-sunken); color: var(--ink); }
.desk-project.is-on { background: var(--accent-soft); }
.desk-project-name { font: 600 var(--fs-sm) var(--font-serif); line-height: 1.3; }
.desk-project-foot { display: flex; align-items: center; justify-content: space-between; min-height: 20px; }
.desk-project-new { color: var(--gold-ink); font: 600 var(--fs-xs) var(--font-ui); }
.desk-faces { display: inline-flex; align-items: center; padding-left: 4px; }
.desk-face { width: 20px; height: 20px; margin-left: -4px; border: 1.5px solid var(--card); font-size: var(--fs-2xs); }
.desk-more { margin-left: var(--space-1); color: var(--ink-faint); font-size: var(--fs-2xs); }

.desk-main { min-width: 0; }
.desk-main-head { display: flex; align-items: center; gap: var(--space-3); min-height: 36px; margin-bottom: var(--space-1); }
.desk-main-head h2 { display: flex; align-items: baseline; gap: var(--space-2); margin: 0; font: 600 var(--fs-xl) var(--font-serif); }
.desk-actions { display: flex; align-items: center; gap: var(--space-2); margin-left: auto; }
.desk-actions button { padding: 5px 12px; font: 500 var(--fs-sm) var(--font-ui); }
.desk-actions .upload-section.is-trigger { position: relative; margin: 0; }
.upload-menu { position: absolute; right: 0; z-index: 20; display: grid; min-width: 10rem; margin-top: 4px; padding: var(--space-1); border: 1px solid var(--line); border-radius: var(--radius); background: var(--card); box-shadow: var(--shadow-md); }
.upload-menu button { padding: 6px var(--space-3); border: 0; border-radius: var(--radius); background: none; box-shadow: none; color: var(--ink); font: 400 var(--fs-sm) var(--font-ui); text-align: left; }
.upload-menu button:hover, .upload-menu button:focus-visible { background: var(--paper-sunken); }
.desk-actions .upload-section.is-trigger .error { position: absolute; right: 0; z-index: 10; width: min(360px, 80vw); margin-top: 6px; }
/* The filter and the column heads stay at the top of the window while the
   rows scroll under them; NookDesk measures the filter into --desk-filter-h. */
.desk-filter { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) 0 var(--space-3); background: var(--paper); }
.desk-search { flex: 0 1 15rem; min-width: 8rem; height: 32px; box-sizing: border-box; padding: 0 var(--space-3); border: 1px solid var(--line); border-radius: var(--radius); background: var(--card); font: 400 var(--fs-sm) var(--font-ui); }
.desk-chips { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-4); min-width: 0; }
.desk-tags { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.desk-manage { margin-left: auto; }
.desk-tag { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border: 0; border-radius: var(--radius-pill); background: transparent; box-shadow: none; color: var(--ink-soft); font: 400 var(--fs-xs) var(--font-ui); }
.desk-tag:hover, .desk-tag:focus-visible { background: var(--paper-sunken); }
.desk-tag.is-on { background: var(--accent-soft); color: var(--accent); }
.desk-table { width: 100%; table-layout: fixed; border-collapse: collapse; border: 1px solid var(--line); border-radius: var(--radius); background: var(--card); }
.desk-table th { position: sticky; top: calc(var(--desk-filter-h, 1px) - 1px); z-index: 1; height: 32px; padding: 0 var(--space-3); background: var(--card); box-shadow: inset 0 -1px var(--line); color: var(--ink-faint); font: 600 var(--fs-2xs) var(--font-ui); letter-spacing: .08em; text-align: left; text-transform: uppercase; white-space: nowrap; }
.desk-table td { height: 52px; padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--line); line-height: 1.3; vertical-align: middle; }
.desk-table tbody tr:last-child td { border-bottom: 0; }
.desk-table tbody tr:hover td { background: var(--paper-sunken); }
/* The member's place in the bar before they are known: held, not drawn. */
.way-self.is-unknown { visibility: hidden; }
.way-self.is-unknown > .nav-avatar { display: inline-block; }
/* A nook that had to be waited for comes in once, in one short fade. */
.nook.is-arriving { animation: nook-arrive 120ms ease-out; }
@keyframes nook-arrive { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .nook.is-arriving { animation: none; } }
.desk-table td.desk-col-title { position: relative; padding-left: calc(var(--space-3) + 6px); }
.desk-table td.desk-col-title::before { content: ""; position: absolute; left: var(--space-2); top: var(--space-2); bottom: var(--space-2); width: 3px; border-radius: 2px; background: var(--shelf-color, var(--line-strong)); }
.desk-title { color: var(--ink); font: 400 var(--fs-md) var(--font-serif); line-height: 1.3; text-decoration: none; }
.desk-title:hover, .desk-title:focus-visible { color: var(--accent); text-decoration: underline; }
.desk-meta { display: block; margin-top: 2px; overflow: hidden; color: var(--ink-faint); font: 400 var(--fs-xs) var(--font-ui); text-overflow: ellipsis; white-space: nowrap; }
.desk-meta i { font-family: var(--font-serif); }
.desk-row-tags { display: flex; flex-wrap: wrap; gap: 2px var(--space-2); margin-top: 3px; }
.desk-row-tag { padding: 0; border: 0; background: transparent; box-shadow: none; color: var(--ink-soft); font: 400 var(--fs-xs) var(--font-ui); cursor: pointer; }
.desk-row-tag:hover, .desk-row-tag:focus-visible { color: var(--accent); }
.desk-row-tag.is-on { color: var(--accent); }
.desk-col-dots { width: 6rem; white-space: nowrap; }
.desk-col-faces { width: 6.5rem; white-space: nowrap; }
.desk-col-date { width: 4.5rem; white-space: nowrap; }
.desk-col-date { color: var(--ink-faint); font: 400 var(--fs-xs) var(--font-ui); text-align: right; font-variant-numeric: tabular-nums; }
.desk-table th.desk-col-date { text-align: right; }
.desk-col-dots .rating-dots { display: inline-flex; gap: 3px; }
.desk-none { color: var(--ink-faint); font-size: var(--fs-sm); }
/* Inside a project the rail folds to a strip of project letters and the
   project takes the width. Resting on the strip, or tabbing into it, lays
   the whole rail over the project's edge; a short wait keeps a pointer
   passing by from opening it. */
.nook-desk.is-folded { grid-template-columns: 2.25rem minmax(0, 1fr); gap: var(--space-5); }
.nook-desk.is-folded .desk-rail { z-index: 30; }
.desk-strip { display: grid; gap: var(--space-1); margin: 0; padding: 0; list-style: none; }
.desk-strip-mark {
  position: relative; display: grid; place-items: center; width: 2.25rem; height: 2.25rem; border-radius: var(--radius);
  color: var(--ink-faint); font: 600 var(--fs-sm) var(--font-serif); text-decoration: none;
}
.desk-strip-mark:hover { background: var(--paper-sunken); color: var(--ink); }
.desk-strip-mark.is-on { background: var(--accent-soft); color: var(--ink); }
.desk-strip-mark.has-new::after { content: ""; position: absolute; top: 5px; right: 5px; width: 6px; height: 6px; border-radius: 50%; background: var(--gold); }
.nook-desk.is-folded .desk-rail-body {
  position: absolute; top: calc(-1 * var(--space-2)); left: calc(-1 * var(--space-2));
  width: 15rem; max-height: calc(100vh - 2 * var(--space-4)); overflow-y: auto; padding: var(--space-2);
  border-radius: var(--radius); background: var(--paper); box-shadow: var(--shadow-md);
  opacity: 0; pointer-events: none; transition: opacity 0s 120ms;
}
.nook-desk.is-folded .desk-rail:hover .desk-rail-body { opacity: 1; pointer-events: auto; transition-delay: 180ms; }
.nook-desk.is-folded .desk-rail:focus-within .desk-rail-body { opacity: 1; pointer-events: auto; transition-delay: 0s; }
.nook-desk.is-reviewing { grid-template-columns: minmax(0, 1fr); }
.nook-desk.is-reviewing .desk-rail,
.nook-desk.is-reviewing .desk-filter,
.nook-desk.is-reviewing .desk-table,
.nook-desk.is-reviewing .desk-main-head h2 { display: none; }
.nook-desk.is-reviewing .desk-main-head, .nook-desk.is-reviewing .desk-actions { display: block; margin: 0; }
@media (max-width: 760px) {
  .nook-desk { grid-template-columns: minmax(0, 1fr); gap: var(--space-5); }
  .desk-rail, .desk-rail-body { position: static; display: contents; }
  .nook-desk.is-folded { grid-template-columns: minmax(0, 1fr); }
  .nook-desk.is-folded .desk-rail { display: none; }
  .desk-rail-part:first-child { order: -2; }
  .desk-main { order: -1; }
  .desk-main-head { margin-bottom: var(--space-3); }
  .desk-filter { position: static; flex-wrap: wrap; padding: 0; margin-bottom: var(--space-3); }
  .desk-search { flex: 1 1 100%; }
  .desk-table thead, .desk-table .desk-col-date { display: none; }
  .desk-table, .desk-table tbody { display: block; table-layout: auto; }
  .desk-table td.desk-col-dots, .desk-table td.desk-col-faces { width: auto; }
  .desk-table tr { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; border-bottom: 1px solid var(--line); }
  .desk-table tbody tr:last-child { border-bottom: 0; }
  .desk-table td { display: block; height: auto; border: 0; }
  .desk-table td.desk-col-title { grid-row: span 2; }
  .desk-meta { white-space: normal; }
  .desk-table.no-merit td.desk-col-dots, .desk-table td.desk-col-dots:nth-child(3) { display: none; }
}

/* Product-wide motion preference. Component media rules can remove layout
   transitions more selectively, while this guarantees that no newly added
   animation escapes the user's operating-system preference. */
`;
