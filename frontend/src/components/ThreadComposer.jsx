import React, { useEffect, useRef, useState } from 'react';
import { startThread } from '../../../shared/api/friends.js';
import { storeFile } from '../../../shared/api/files.js';
import appLimits from '../../../shared/appLimits.js';
import { linkSelection, prefixLines, wrapSelection } from '../../../shared/markdownFormat.js';
import Face from '../../../shared/ui/Face.jsx';
import MarkdownField from '../../../shared/ui/MarkdownField.jsx';
import { formatBytes } from '../../../shared/waiting.js';

/**
 * The box the Lounge opens with: start a thread from no paper.
 *
 * Words are written as Markdown and shown formatted as they are typed;
 * the bar under them puts the marks in for whoever would rather press a
 * button. Pictures and files are attached from the same bar, by pasting,
 * or by dropping them on the box. Each is uploaded as it is added, so
 * sending is quick and a file too large is refused at once.
 */

const FILE_MB = appLimits.files.board_file_mb;
const FILES_MAX = appLimits.counts.thread_files;
// What a browser draws in a page; the service says the same (threads.ts).
const PICTURE = /^image\/(png|jpeg|gif|webp)$/;

const icon = (paths) => <svg viewBox="0 0 24 24" aria-hidden="true">{paths}</svg>;
const TOOLS = [
  { key: 'bold', label: 'Bold', hint: '⌘B', mark: <b>B</b>, change: (at) => wrapSelection(at, '**', 'bold') },
  { key: 'italic', label: 'Italic', hint: '⌘I', mark: <i>I</i>, change: (at) => wrapSelection(at, '*', 'italic') },
  { key: 'strike', label: 'Strikethrough', mark: <s>S</s>, change: (at) => wrapSelection(at, '~~', 'struck') },
  { key: 'code', label: 'Code', mark: icon(<path d="m9 8-4 4 4 4m6-8 4 4-4 4" />), change: (at) => wrapSelection(at, '`', 'code') },
  { key: 'link', label: 'Link', hint: '⌘K', mark: icon(<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>), change: linkSelection, gap: true },
  { key: 'bullet', label: 'Bulleted list', mark: icon(<><path d="M9.5 7h10m-10 5h10m-10 5h10" /><circle cx="5" cy="7" r="1" /><circle cx="5" cy="12" r="1" /><circle cx="5" cy="17" r="1" /></>), change: (at) => prefixLines(at, 'bullet'), gap: true },
  { key: 'number', label: 'Numbered list', mark: icon(<><path d="M10 7h9.5M10 12h9.5M10 17h9.5" /><path d="M4.3 5.6 5.6 5v4M4.2 13.6c.2-.8 2.2-.9 2.2.2 0 .9-2.2 1.6-2.2 2.700h2.3" /></>), change: (at) => prefixLines(at, 'number') },
  { key: 'quote', label: 'Quote', mark: icon(<><path d="M5 5v14" /><path d="M9.5 8h10m-10 4h10m-10 4h6" /></>), change: (at) => prefixLines(at, 'quote') },
];
const KEYS = { b: 'bold', i: 'italic', k: 'link' };

let nextKey = 1;

export default function ThreadComposer({ currentUser, onStarted }) {
  const [words, setWords] = useState('');
  // { key, file, name, size, mime, picture, preview, state: 'storing' | 'stored' | 'failed', fraction, sha256, error }
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [over, setOver] = useState(false);
  // At rest the box is one quiet line. It opens, with its bar, when the
  // caret goes in, and stays open while it holds anything.
  const [active, setActive] = useState(false);
  const picking = useRef(false); // the file chooser takes the focus away without the box being left
  const field = useRef(null);
  const pickPicture = useRef(null);
  const pickFile = useRef(null);
  const live = useRef(new Map()); // key -> AbortController, for uploads under way

  // Previews are the browser's own addresses for the bytes; let them go.
  const previews = useRef(new Set());
  useEffect(() => () => {
    previews.current.forEach((url) => URL.revokeObjectURL(url));
    live.current.forEach((stop) => stop.abort());
  }, []);

  const patch = (key, change) => setFiles((now) => now.map((f) => (f.key === key ? { ...f, ...change } : f)));

  const attach = (picked) => {
    const list = [...picked];
    if (!list.length) return;
    setError(null);
    const room = FILES_MAX - files.length;
    if (list.length > room) setError(`A thread takes at most ${FILES_MAX} files.`);
    const added = [];
    for (const file of list.slice(0, Math.max(0, room))) {
      if (file.size > FILE_MB * 1024 * 1024) { setError(`${file.name} is larger than ${FILE_MB} MB.`); continue; }
      if (!file.size) { setError(`${file.name} is empty.`); continue; }
      const mime = (file.type || '').split(';')[0] || null;
      const picture = PICTURE.test(mime || '');
      const preview = picture ? URL.createObjectURL(file) : null;
      if (preview) previews.current.add(preview);
      added.push({ key: nextKey++, file, name: file.name || (picture ? 'picture.png' : 'file'), size: file.size, mime, picture, preview, state: 'storing', fraction: 0 });
    }
    if (!added.length) return;
    setFiles((now) => [...now, ...added]);
    for (const entry of added) {
      const stop = new AbortController();
      live.current.set(entry.key, stop);
      storeFile('board_file', entry.file, {
        name: entry.name, mime: entry.mime, signal: stop.signal,
        onProgress: ({ phase, loaded, total }) => { if (phase === 'uploading' && total) patch(entry.key, { fraction: loaded / total }); },
      })
        .then(({ sha256 }) => patch(entry.key, { state: 'stored', sha256 }))
        .catch((err) => { if (!stop.signal.aborted) patch(entry.key, { state: 'failed', error: err?.message || String(err) }); })
        .finally(() => live.current.delete(entry.key));
    }
  };

  const detach = (entry) => {
    live.current.get(entry.key)?.abort();
    if (entry.preview) { URL.revokeObjectURL(entry.preview); previews.current.delete(entry.preview); }
    setFiles((now) => now.filter((f) => f.key !== entry.key));
  };

  const storing = files.some((f) => f.state === 'storing');
  const failed = files.some((f) => f.state === 'failed');
  const ready = !busy && !storing && !failed && (words.trim() || files.length > 0);

  const send = async (event) => {
    event?.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const thread = await startThread(words.trim() || null, files.map((f) => ({ sha256: f.sha256, name: f.name, mime: f.mime, size: f.size })));
      files.forEach((f) => { if (f.preview) { URL.revokeObjectURL(f.preview); previews.current.delete(f.preview); } });
      setWords('');
      setFiles([]);
      onStarted(thread);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const keyDown = (event) => {
    const mod = event.metaKey || event.ctrlKey;
    if (!mod || event.altKey) return;
    if (event.key === 'Enter') { send(event); return; }
    const tool = TOOLS.find((t) => t.key === KEYS[event.key.toLowerCase()]);
    if (tool && !event.shiftKey) { event.preventDefault(); field.current?.edit(tool.change); }
  };

  // Files pasted or dropped are attached; words pasted are left to the box.
  const pasted = (event) => {
    const got = [...(event.clipboardData?.files ?? [])];
    if (got.length) { event.preventDefault(); attach(got); }
  };
  const carriesFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');
  const dropped = (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setOver(false);
    attach(event.dataTransfer.files);
  };

  const open = active || Boolean(words) || files.length > 0 || Boolean(error);
  const left = (event) => {
    if (picking.current || event.currentTarget.contains(event.relatedTarget)) return;
    setActive(false);
  };
  const choose = (input) => {
    picking.current = true;
    // The chooser closed, with files or without: the box has the caret again.
    window.addEventListener('focus', () => { picking.current = false; field.current?.focus(); }, { once: true });
    input.current?.click();
  };

  const full = files.length >= FILES_MAX;
  const pictures = files.filter((f) => f.picture);
  const others = files.filter((f) => !f.picture);

  return (
    <form
      className={`thread-composer${open ? ' is-open' : ''}${over ? ' is-over' : ''}`} onSubmit={send} aria-label="Start a thread"
      onFocus={() => setActive(true)} onBlur={left}
      onDragOver={(event) => { if (carriesFiles(event)) { event.preventDefault(); event.stopPropagation(); setOver(true); } }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOver(false); }}
      onDrop={dropped}
    >
      <div className="thread-composer-write">
        <Face user={currentUser} />
        <MarkdownField
          ref={field} rows={1} value={words} maxLength={appLimits.text.thread_words} placeholder="Start a thread" aria-label="Start a thread"
          onChange={(event) => setWords(event.target.value)} onKeyDown={keyDown} onPaste={pasted}
        />
        {!open && (
          <span className="thread-composer-cue" aria-hidden="true" onMouseDown={(event) => { event.preventDefault(); field.current?.focus(); }}>
            <svg viewBox="0 0 24 24"><path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1z" /><path d="M14.5 6.5l3 3" /></svg>
          </span>
        )}
      </div>

      {files.length > 0 && (
        <div className="thread-composer-files">
          {pictures.length > 0 && (
            <ul className="thread-composer-pictures" aria-label="Pictures attached">
              {pictures.map((f) => (
                <li key={f.key} className={`is-${f.state}`} title={f.error || f.name}>
                  <img src={f.preview} alt={f.name} />
                  {f.state === 'storing' && <span className="thread-composer-bar" aria-hidden="true"><span style={{ width: `${Math.round(f.fraction * 100)}%` }} /></span>}
                  <button type="button" className="thread-composer-remove" aria-label={`Remove ${f.name}`} title="Remove" onClick={() => detach(f)}>×</button>
                </li>
              ))}
            </ul>
          )}
          {others.length > 0 && (
            <ul className="thread-composer-attached" aria-label="Files attached">
              {others.map((f) => (
                <li key={f.key} className={`is-${f.state}`} title={f.error || f.name}>
                  <FileGlyph />
                  <span className="thread-composer-name">{f.name}</span>
                  <span className="thread-composer-size">
                    {f.state === 'failed' ? 'Not uploaded' : f.state === 'storing' ? `${Math.round(f.fraction * 100)}%` : formatBytes(f.size)}
                  </span>
                  <button type="button" className="thread-composer-remove" aria-label={`Remove ${f.name}`} title="Remove" onClick={() => detach(f)}>×</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <div className="error" role="alert">{error}</div>}

      {open && (
      <div className="thread-composer-bar-row">
        {/* Pressing a button must not take the caret out of the box. */}
        <div className="thread-composer-tools" role="toolbar" aria-label="Formatting" onMouseDown={(event) => event.preventDefault()}>
          {TOOLS.map((tool) => (
            <button
              key={tool.key} type="button" className={`thread-composer-tool${tool.gap ? ' has-gap' : ''}`}
              aria-label={tool.label} title={tool.hint ? `${tool.label} (${tool.hint})` : tool.label}
              onClick={() => field.current?.edit(tool.change)}
            >
              {tool.mark}
            </button>
          ))}
          <button type="button" className="thread-composer-tool has-gap" aria-label="Attach pictures" title="Attach pictures" disabled={full} onClick={() => choose(pickPicture)}>
            {icon(<><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17 5-4.5 3.5 3 3-2.5 4.5 4" /></>)}
          </button>
          <button type="button" className="thread-composer-tool" aria-label="Attach files" title={`Attach files, up to ${FILE_MB} MB each`} disabled={full} onClick={() => choose(pickFile)}>
            {icon(<path d="m19.5 11.5-7.3 7.300a4.2 4.2 0 0 1-6-6l7.6-7.600a2.8 2.8 0 0 1 4 4l-7.5 7.500a1.4 1.4 0 0 1-2-2l6.8-6.8" />)}
          </button>
        </div>
        <input ref={pickPicture} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={(event) => { attach(event.target.files); event.target.value = ''; }} />
        <input ref={pickFile} type="file" multiple hidden onChange={(event) => { attach(event.target.files); event.target.value = ''; }} />
        <button type="submit" className="talk-send" disabled={!ready} aria-label="Start the thread" title={storing ? 'Uploading…' : 'Start the thread (⌘↩)'}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
        </button>
      </div>
      )}
    </form>
  );
}

export function FileGlyph() {
  return icon(<><path d="M13.5 3.500H7a1.5 1.5 0 0 0-1.5 1.500v14A1.5 1.5 0 0 0 7 20.500h10a1.5 1.5 0 0 0 1.5-1.500V8.500z" /><path d="M13.5 3.500v5h5" /></>);
}
