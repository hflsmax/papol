import { DESKTOP } from './desktopShell';

// window.confirm() is the browser's own dialog. Papol macOS's macOS webview
// implements no JavaScript dialogs at all: confirm() answers false without
// showing anything, so every "are you sure?" in the app silently cancelled
// the thing it was guarding. Inside the app this asks with a sheet of its
// own; in a browser it is still the browser's dialog.
//
// It resolves to true or false, so a caller awaits it:
//   if (!(await confirmAction('Delete this note?', { confirmLabel: 'Delete', destructive: true }))) return;
//
// The page's tokens are used where the page has them; the fallbacks are for
// a page that loads this without Papol's stylesheet.

const STYLE_ID = 'papol-confirm-style';

const STYLE = `
.papol-confirm-overlay {
  position: fixed; inset: 0; z-index: 10000;
  display: grid; place-items: start center; padding: 18vh 16px 0;
  background: rgba(29, 33, 41, 0.28);
  animation: papol-confirm-fade 0.12s ease-out;
}
.papol-confirm {
  width: min(380px, 100%); padding: 20px 20px 16px;
  border-radius: var(--radius-lg, 10px);
  background: var(--card, #fff); color: var(--ink, #1d2129);
  box-shadow: 0 18px 50px rgba(20, 25, 35, 0.28), 0 0 0 1px rgba(20, 25, 35, 0.08);
  font-family: var(--font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif);
  font-size: var(--fs-sm, 0.85rem); line-height: 1.45;
  cursor: default; user-select: none; -webkit-user-select: none;
}
.papol-confirm p { margin: 0 0 18px; white-space: pre-line; }
.papol-confirm-actions { display: flex; justify-content: flex-end; gap: 8px; }
.papol-confirm .papol-confirm-button,
.papol-confirm .papol-confirm-button:hover:not(:disabled) {
  min-width: 84px; padding: 5px 14px;
  border: 1px solid var(--line-strong, #b4becb); border-radius: var(--chrome-radius, 6px);
  background: var(--card, #fff); color: var(--ink, #1d2129);
  font: inherit; line-height: 1.4; box-shadow: none; cursor: default; transition: none;
}
.papol-confirm .papol-confirm-button.ok,
.papol-confirm .papol-confirm-button.ok:hover:not(:disabled) {
  border-color: var(--accent, #2b4a6f); background: var(--accent, #2b4a6f); color: var(--ink-inverse, #fff);
}
.papol-confirm .papol-confirm-button.ok.destructive,
.papol-confirm .papol-confirm-button.ok.destructive:hover:not(:disabled) {
  border-color: var(--red, #8c2f22); background: var(--red, #8c2f22);
}
.papol-confirm .papol-confirm-button:focus-visible { outline: 2px solid var(--accent, #2b4a6f); outline-offset: 2px; }
@keyframes papol-confirm-fade { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .papol-confirm-overlay { animation: none; } }
`;

let nextId = 0;

export function confirmAction(message, { confirmLabel = 'OK', cancelLabel = 'Cancel', destructive = false } = {}) {
  if (!DESKTOP) return Promise.resolve(window.confirm(message));

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  return new Promise((resolve) => {
    const returnFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'papol-confirm-overlay';
    const sheet = document.createElement('div');
    sheet.className = 'papol-confirm';
    sheet.setAttribute('role', 'alertdialog');
    sheet.setAttribute('aria-modal', 'true');
    const text = document.createElement('p');
    nextId += 1;
    text.id = `papol-confirm-message-${nextId}`;
    text.textContent = message;
    sheet.setAttribute('aria-describedby', text.id);

    const actions = document.createElement('div');
    actions.className = 'papol-confirm-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'papol-confirm-button';
    cancel.textContent = cancelLabel;
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = `papol-confirm-button ok${destructive ? ' destructive' : ''}`;
    ok.textContent = confirmLabel;
    actions.append(cancel, ok);
    sheet.append(text, actions);
    overlay.append(sheet);

    const finish = (answer) => {
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
      resolve(answer);
    };
    // While the sheet is up it owns the keyboard: Escape cancels, Tab moves
    // between its two buttons, and nothing reaches the page underneath.
    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      } else if (event.key === 'Tab') {
        event.preventDefault();
        (document.activeElement === ok ? cancel : ok).focus();
      } else if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      event.stopImmediatePropagation();
    }
    cancel.addEventListener('click', () => finish(false));
    ok.addEventListener('click', () => finish(true));
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) finish(false); });
    window.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    // A destructive action is never the default: Return confirms only what
    // cannot hurt, as in a native alert.
    (destructive ? cancel : ok).focus();
  });
}
