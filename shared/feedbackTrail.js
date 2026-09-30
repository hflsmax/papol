import { APP_ENV, DESKTOP_VERSION, IS_DESKTOP } from './appEnvironment.js';
import appLimits from './appLimits.js';
import { diagnosticText } from './errorReport.js';

// What a report says about where its writer was and what they had just
// done, so an admin can retrace it without asking. Every report carries
// it. The trail keeps the last few pages opened, controls pressed and
// errors raised in this tab (sessionStorage, so it follows the reader from
// the nook into the viewer and a board). It records what the control is
// called, never what anyone wrote: no field values, no digs, no keys.

const STORAGE_KEY = 'papol.feedbackTrail';
const TRAIL_LENGTH = appLimits.counts.feedback_trail;
const FIELD_LENGTH = appLimits.text.feedback_page;
const LABEL_LENGTH = 48;

// The build's commit on the web, stamped by Vite; the desktop says its own
// version.
const BUILD = typeof __PAPOL_BUILD__ === 'string' ? __PAPOL_BUILD__ : null;

let app = null;
let memory = [];

function readTrail() {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(stored) ? stored : [];
  } catch {
    return memory;
  }
}

function writeTrail(trail) {
  memory = trail;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trail));
  } catch {
    // Private windows may refuse storage; the trail then lives in memory.
  }
}

export function recordStep(kind, happened) {
  if (!happened) return;
  const what = String(happened).slice(0, FIELD_LENGTH);
  const trail = readTrail();
  // A page rewriting its own address is not a new page.
  const lastOpen = trail.findLast((step) => step.kind === 'open');
  if (kind === 'open' && lastOpen?.what === what) return;
  writeTrail([...trail, { at: Date.now(), kind, what }].slice(-TRAIL_LENGTH));
}

export function feedbackTrail() {
  return readTrail().slice(-TRAIL_LENGTH);
}

function squeeze(text) {
  const plain = String(text || '').replace(/\s+/g, ' ').trim();
  return plain.length > LABEL_LENGTH ? `${plain.slice(0, LABEL_LENGTH - 1)}…` : plain;
}

// Controls whose own text is their name. Anything else is named only by
// its aria-label or title, so a card or row never leaks what it holds.
const NAMED_BY_TEXT = 'button, [role="tab"], [role="menuitem"], summary, label';
const CONTROL = `a[href], input, select, textarea, [role="button"], [role="option"], [role="checkbox"], [role="switch"], ${NAMED_BY_TEXT}`;

export function describeClick(target) {
  const element = target?.closest?.(CONTROL);
  if (!element) {
    const plain = target?.closest?.('[class]');
    const name = plain && typeof plain.className === 'string' ? plain.className.trim().split(/\s+/)[0] : '';
    return name ? `${plain.tagName.toLowerCase()}.${name}` : null;
  }
  const tag = element.tagName.toLowerCase();
  const given = element.getAttribute('aria-label') || element.getAttribute('title');
  if (tag === 'a') {
    let where = '';
    try {
      const url = new URL(element.href, window.location.href);
      where = url.origin === window.location.origin ? url.pathname : url.host;
    } catch {
      where = '';
    }
    return `link ${given ? `"${squeeze(given)}" ` : ''}${where}`.trim();
  }
  if (tag === 'input' || tag === 'select' || tag === 'textarea') {
    const type = tag === 'input' ? (element.type || 'text') : tag;
    const name = given || element.name || element.id;
    return `${type === 'text' || type === 'textarea' ? 'field' : type}${name ? ` "${squeeze(name)}"` : ''}`;
  }
  const label = given || (element.matches(NAMED_BY_TEXT) ? element.textContent : '');
  const role = tag === 'button' ? 'button' : (element.getAttribute('role') || tag);
  return label ? `${role} "${squeeze(label)}"` : role;
}

function where() {
  return (window.location.pathname || '/').slice(0, FIELD_LENGTH);
}

// Start the trail for one app ('nook', 'viewer', 'board'). Idempotent.
export function startFeedbackTrail(name) {
  if (app) return;
  app = name;
  recordStep('open', where());
  const opened = () => recordStep('open', where());
  for (const method of ['pushState', 'replaceState']) {
    const original = window.history[method];
    window.history[method] = function trailed(...args) {
      const result = original.apply(this, args);
      opened();
      return result;
    };
  }
  window.addEventListener('popstate', opened);
  document.addEventListener('click', (event) => recordStep('click', describeClick(event.target)), true);
  window.addEventListener('error', (event) => {
    recordStep('error', diagnosticText(event.message || event.error?.message).slice(0, 160));
  });
  window.addEventListener('unhandledrejection', (event) => {
    recordStep('error', diagnosticText(event.reason?.message || event.reason).slice(0, 160));
  });
}

export function browserAndSystem(agent = navigator.userAgent || '') {
  const browser = (() => {
    if (IS_DESKTOP) return 'Papol app';
    const match = agent.match(/Edg\/(\d+)/) ? ['Edge', agent.match(/Edg\/(\d+)/)[1]]
      : agent.match(/Firefox\/(\d+)/) ? ['Firefox', agent.match(/Firefox\/(\d+)/)[1]]
        : agent.match(/Chrome\/(\d+)/) ? ['Chrome', agent.match(/Chrome\/(\d+)/)[1]]
          : agent.match(/Version\/(\d+(?:\.\d+)?).*Safari/) ? ['Safari', agent.match(/Version\/(\d+(?:\.\d+)?)/)[1]]
            : null;
    return match ? `${match[0]} ${match[1]}` : 'unknown browser';
  })();
  const system = /iPhone|iPad/.test(agent) ? 'iOS'
    : /Android/.test(agent) ? 'Android'
      : /Mac OS X/.test(agent) ? 'macOS'
        : /Windows/.test(agent) ? 'Windows'
          : /Linux/.test(agent) ? 'Linux' : 'unknown system';
  return { browser, system };
}

// Everything a report says about its moment. `extra` is what only the
// surface knows (the project a paper is read in).
export function feedbackContext(extra = {}) {
  const { browser, system } = browserAndSystem();
  // A page names what is open ahead of the app: "<paper> — Papol".
  const named = (document.title || '').replace(/\s*— Papol$/, '').trim();
  const title = named && !named.startsWith('Papol') ? named.slice(0, FIELD_LENGTH) : null;
  return {
    app: app || 'nook',
    runtime: IS_DESKTOP ? 'mac' : 'web',
    window: IS_DESKTOP ? (APP_ENV.surface || 'desk') : null,
    version: DESKTOP_VERSION || BUILD,
    page: where(),
    title,
    project: extra.project ? String(extra.project).slice(0, FIELD_LENGTH) : null,
    viewport: `${window.innerWidth}×${window.innerHeight} at ${window.devicePixelRatio || 1}x`,
    browser,
    system,
    language: navigator.language || null,
    online: navigator.onLine !== false,
    sent_at: Date.now(),
    trail: feedbackTrail(),
  };
}
