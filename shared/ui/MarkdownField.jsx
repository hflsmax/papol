import React, { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { styledMarkdown } from '../markdownStyled.js';

// A box for writing Markdown that shows what the marks do as they are
// typed: `code` turns to code type at once, **bold** to bold, a # line to a
// heading, and the marks themselves stay, faint. What is typed is exactly
// what is saved; only its look changes. It stands where a <textarea> would
// and answers the same calls (value, focus, setSelectionRange).
//
// A textarea can only show plain text, so this is an editable element that
// is given its words back, styled, after every change, with the caret put
// back where it was. Because the page's own undo cannot follow that, the
// box keeps its own.

// The words in the box, whatever the browser has done to it: text as it
// stands, a line break for each <br> it added (not the one kept at the end
// so a last empty line shows), and a break before each block it split off.
function textOf(root) {
  let out = '';
  const walk = (node) => {
    node.childNodes.forEach((child, i) => {
      if (child.nodeType === Node.TEXT_NODE) out += child.data;
      else if (child.nodeName === 'BR') { if (!child.dataset.end) out += '\n'; }
      else {
        const block = /^(DIV|P)$/.test(child.nodeName);
        if (block && i > 0 && !out.endsWith('\n')) out += '\n';
        walk(child);
      }
    });
  };
  walk(root);
  return out;
}

// Where a point in the box falls in its words, and back.
function offsetOf(root, node, offset) {
  const range = document.createRange();
  range.selectNodeContents(root);
  try { range.setEnd(node, offset); } catch { return 0; }
  const holder = document.createElement('div');
  holder.appendChild(range.cloneContents());
  return textOf(holder).length;
}

function pointAt(root, target) {
  let left = target;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let lastNode = null;
  while (node) {
    if (left <= node.data.length) return [node, left];
    left -= node.data.length;
    lastNode = node;
    node = walker.nextNode();
  }
  return lastNode ? [lastNode, lastNode.data.length] : [root, 0];
}

function selectionIn(root) {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !root.contains(sel.anchorNode)) return null;
  const a = offsetOf(root, sel.anchorNode, sel.anchorOffset);
  const f = offsetOf(root, sel.focusNode, sel.focusOffset);
  return [Math.min(a, f), Math.max(a, f)];
}

function select(root, start, end = start) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  const [sNode, sOff] = pointAt(root, start);
  const [eNode, eOff] = pointAt(root, end);
  range.setStart(sNode, sOff);
  range.setEnd(eNode, eOff);
  sel.removeAllRanges();
  sel.addRange(range);
}

const draw = (root, text) => {
  root.innerHTML = `${styledMarkdown(text)}<br data-end="1">`;
  if (text) root.removeAttribute('data-empty');
  else root.setAttribute('data-empty', '');
};

const MarkdownField = forwardRef(function MarkdownField({
  value = '', onChange, onKeyDown, onFocus, onBlur, placeholder, rows = 1, maxLength, autoFocus = false, className = '', name, id, style, ...rest
}, ref) {
  const box = useRef(null);
  const text = useRef(value);
  const history = useRef({ past: [], future: [], at: 0 });
  const composing = useRef(false);

  const tell = useCallback((next) => { onChange?.({ target: { name, value: next }, currentTarget: { name, value: next } }); }, [onChange, name]);

  // Records the words before a change, so undo can bring them back.
  // Typing in one run is one step.
  const remember = (kind) => {
    const h = history.current;
    const now = Date.now();
    const run = kind === 'type' && h.kind === 'type' && now - h.at < 1000;
    if (!run) h.past.push({ text: text.current, caret: selectionIn(box.current) ?? [text.current.length, text.current.length] });
    if (h.past.length > 200) h.past.shift();
    h.future = [];
    h.at = now;
    h.kind = kind;
  };

  const settle = (next, caret) => {
    const root = box.current;
    text.current = next;
    draw(root, next);
    if (caret) select(root, caret[0], caret[1]);
    tell(next);
  };

  // Puts `insert` in place of the selection, as typing or pasting would.
  const replace = (insert, kind) => {
    const root = box.current;
    const [start, end] = selectionIn(root) ?? [text.current.length, text.current.length];
    let next = text.current.slice(0, start) + insert + text.current.slice(end);
    if (maxLength && next.length > maxLength) {
      const room = Math.max(0, maxLength - (text.current.length - (end - start)));
      next = text.current.slice(0, start) + insert.slice(0, room) + text.current.slice(end);
      insert = insert.slice(0, room);
    }
    remember(kind);
    settle(next, [start + insert.length, start + insert.length]);
  };

  const step = (from, to) => {
    const h = history.current;
    const entry = h[from].pop();
    if (!entry) return;
    h[to].push({ text: text.current, caret: selectionIn(box.current) ?? [0, 0] });
    h.kind = null;
    settle(entry.text, entry.caret);
  };

  // React's onBeforeInput is its own stand-in and hides inputType, so the
  // browser's event is listened to directly.
  const before = useRef(null);
  useLayoutEffect(() => {
    const root = box.current;
    const listen = (event) => before.current(event);
    root.addEventListener('beforeinput', listen);
    return () => root.removeEventListener('beforeinput', listen);
  }, []);

  useLayoutEffect(() => {
    const root = box.current;
    try { root.contentEditable = 'plaintext-only'; } catch { root.contentEditable = 'true'; }
    if (root.contentEditable !== 'plaintext-only') root.contentEditable = 'true';
    draw(root, text.current);
    if (autoFocus) { root.focus(); select(root, text.current.length); }
  }, []);

  // Its label, pressed, puts the caret in it, as it would in a textarea.
  useLayoutEffect(() => {
    if (!id) return undefined;
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    const go = () => box.current?.focus();
    label?.addEventListener('click', go);
    return () => label?.removeEventListener('click', go);
  }, [id]);

  // A value set from outside (the box emptied once a post is sent) is
  // drawn; the box's own changes are already there.
  useLayoutEffect(() => {
    if (value === text.current) return;
    const focused = document.activeElement === box.current;
    const caret = focused ? selectionIn(box.current) : null;
    text.current = value;
    draw(box.current, value);
    if (caret) select(box.current, Math.min(caret[0], value.length), Math.min(caret[1], value.length));
  }, [value]);

  useLayoutEffect(() => {
    const root = box.current;
    if (rows <= 1) return;
    const css = getComputedStyle(root);
    const line = parseFloat(css.lineHeight) || parseFloat(css.fontSize) * 1.4;
    const frame = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((sum, k) => sum + (parseFloat(css[k]) || 0), 0);
    root.style.minHeight = `${Math.round(rows * line + frame)}px`;
  }, [rows]);

  useImperativeHandle(ref, () => {
    const root = box.current;
    return {
      element: root,
      get value() { return text.current; },
      focus: (options) => root.focus(options),
      blur: () => root.blur(),
      setSelectionRange: (start, end) => { if (document.activeElement === root) select(root, start, end); },
      scrollIntoView: (options) => root.scrollIntoView(options),
      getBoundingClientRect: () => root.getBoundingClientRect(),
      closest: (selector) => root.closest(selector),
      get style() { return root.style; },
      get scrollHeight() { return root.scrollHeight; },
      get clientHeight() { return root.clientHeight; },
    };
  }, []);

  const beforeInput = (event) => {
    if (composing.current || event.isComposing) return;
    const type = event.inputType;
    if (type === 'historyUndo') { event.preventDefault(); step('past', 'future'); return; }
    if (type === 'historyRedo') { event.preventDefault(); step('future', 'past'); return; }
    if (type === 'insertParagraph' || type === 'insertLineBreak') { event.preventDefault(); replace('\n', 'break'); return; }
    if (type === 'insertText' && event.data != null) { event.preventDefault(); replace(event.data, 'type'); return; }
    if (type === 'insertFromPaste' || type === 'insertFromDrop' || type === 'insertReplacementText') {
      const data = event.dataTransfer?.getData('text/plain') ?? event.data;
      if (data != null) { event.preventDefault(); replace(data.replace(/\r\n?/g, '\n'), 'paste'); }
      return;
    }
    // Deleting, cutting and the like are left to the browser, then read back.
    remember(type.startsWith('delete') ? 'delete' : 'other');
  };

  const input = () => {
    if (composing.current) return;
    const root = box.current;
    const caret = selectionIn(root);
    let next = textOf(root);
    if (maxLength && next.length > maxLength) next = next.slice(0, maxLength);
    settle(next, caret);
  };

  before.current = beforeInput;

  const keyDown = (event) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && !event.altKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) step('future', 'past'); else step('past', 'future');
    } else if (mod && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      step('future', 'past');
    }
  };

  return (
    <div
      ref={box}
      id={id}
      role="textbox"
      aria-multiline="true"
      tabIndex={0}
      spellCheck
      suppressContentEditableWarning
      className={`md-field${className ? ` ${className}` : ''}`}
      style={style}
      data-placeholder={placeholder}
      onKeyDown={keyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      onInput={input}
      onCompositionStart={() => { composing.current = true; remember('other'); }}
      onCompositionEnd={() => { composing.current = false; input(); }}
      {...rest}
    />
  );
});

export default MarkdownField;
