import { useEffect, useRef } from 'react';

const dialogs = [];
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableChildren(dialog) {
  return [...dialog.querySelectorAll(FOCUSABLE)].filter((element) =>
    element.getAttribute('aria-hidden') !== 'true' && !element.hidden);
}

// Gives every modal the same keyboard contract: initial focus, trapped Tab,
// Escape to close, body scroll lock, and focus restoration. The small stack
// keeps an alert/confirmation opened above another dialog from closing both.
export function useModalDialog(open, onClose) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    const returnFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const entry = { dialog };
    dialogs.push(entry);
    document.body.style.overflow = 'hidden';

    const focusInitial = () => {
      if (dialog.contains(document.activeElement)) return;
      const preferred = dialog.querySelector('[autofocus]');
      (preferred || focusableChildren(dialog)[0] || dialog).focus({ preventScroll: true });
    };
    const frame = window.requestAnimationFrame(focusInitial);

    const onKeyDown = (event) => {
      if (dialogs.at(-1) !== entry) return;
      // Imperative confirmation sheets also use aria-modal and may be opened
      // above a React dialog. Let the last modal in DOM order own the key.
      const visibleModals = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')];
      if (visibleModals.at(-1) !== dialog) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = focusableChildren(dialog);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown, true);
      const index = dialogs.indexOf(entry);
      if (index !== -1) dialogs.splice(index, 1);
      document.body.style.overflow = previousOverflow;
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected) {
        returnFocus.focus({ preventScroll: true });
      }
    };
  }, [open]);

  return dialogRef;
}
