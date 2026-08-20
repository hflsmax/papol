import React from 'react';

// A small Markdown subset for the prose a reader writes — summaries and
// notes. It renders to React elements, never to HTML, so nothing typed in
// an edit box can inject markup: text is text, and the only tags that
// appear are the ones this file names.
//
// Supported: headings, bullet and numbered lists (nested), blockquotes,
// fenced code, rules, and the inline marks below. Anything unrecognised
// stays as the literal characters the reader typed.

// Links are the one place a reader's text reaches the browser as a URL, so
// the scheme is checked rather than trusted. A rejected href renders as
// plain text.
const SAFE_HREF = /^(?:https?:\/\/|mailto:|#|\/)/i;

const inlineRe = () =>
  new RegExp(
    [
      '`([^`]+)`', // 1: code
      '\\*\\*([^*]+)\\*\\*', // 2: bold
      '__([^_]+)__', // 3: bold
      '\\*([^*]+)\\*', // 4: italic
      '_([^_]+)_', // 5: italic
      '~~([^~]+)~~', // 6: strikethrough
      '\\[([^\\]]*)\\]\\(([^)\\s]+)\\)', // 7,8: link
      '(https?://[^\\s<]*[^\\s<.,:;"\')\\]])', // 9: bare URL
    ].join('|'),
    'g'
  );

const link = (href, label, key) =>
  SAFE_HREF.test(href) ? (
    <a key={key} href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  ) : (
    <React.Fragment key={key}>{label}</React.Fragment>
  );

// Newlines inside a paragraph are kept as breaks: a reader who pressed
// Enter meant a new line, whatever Markdown's own rules say about it.
const withBreaks = (nodes, key) =>
  nodes.flatMap((node, i) =>
    typeof node !== 'string'
      ? [node]
      : node.split('\n').flatMap((part, j) =>
          j === 0
            ? [part]
            : [<br key={`${key}-br-${i}-${j}`} />, part]
        )
  );

function renderInline(text, key) {
  const re = inlineRe();
  const out = [];
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const k = `${key}-i${m.index}`;
    // Underscores inside a word (snake_case, a DOI, a file name) are part
    // of the word, not emphasis; only a run standing on its own counts.
    if (
      (m[3] !== undefined || m[5] !== undefined) &&
      (/\w/.test(text[m.index - 1] || '') ||
        /\w/.test(text[m.index + m[0].length] || ''))
    ) {
      re.lastIndex = m.index + 1;
      continue;
    }
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<code key={k}>{m[1]}</code>);
    else if (m[2] !== undefined || m[3] !== undefined)
      out.push(<strong key={k}>{renderInline(m[2] ?? m[3], k)}</strong>);
    else if (m[4] !== undefined || m[5] !== undefined)
      out.push(<em key={k}>{renderInline(m[4] ?? m[5], k)}</em>);
    else if (m[6] !== undefined)
      out.push(<del key={k}>{renderInline(m[6], k)}</del>);
    else if (m[8] !== undefined) out.push(link(m[8], renderInline(m[7], k), k));
    else if (m[9] !== undefined) out.push(link(m[9], m[9], k));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return withBreaks(out, key);
}

const BULLET = /^[-*+]\s+(.*)$/;
const NUMBER = /^(\d+)[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const FENCE = /^```/;
const QUOTE = /^>\s?(.*)$/;

const indentOf = (line) => line.length - line.trimStart().length;

// One list, from the first item to the first line that is neither an item
// at this indent nor a continuation of one. Deeper items are handed back to
// parseBlocks inside their parent item, so nesting falls out of recursion.
function takeList(lines, start) {
  const base = indentOf(lines[start]);
  const ordered = NUMBER.test(lines[start].trim());
  const items = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      const next = lines[i + 1];
      if (next && next.trim() && indentOf(next) >= base) {
        i++;
        continue;
      }
      break;
    }
    const indent = indentOf(line);
    const body = line.trim();
    const match = ordered ? NUMBER.exec(body) : BULLET.exec(body);
    if (match && indent <= base) {
      items.push([ordered ? match[2] : match[1]]);
      i++;
    } else if (items.length && indent > base) {
      items[items.length - 1].push(line.slice(base + 1));
      i++;
    } else {
      break;
    }
  }
  return [{ type: 'list', ordered, items }, i];
}

function parseBlocks(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const body = line.trim();

    if (!body) {
      i++;
    } else if (FENCE.test(body)) {
      const code = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i].trim())) code.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push({ type: 'code', text: code.join('\n') });
    } else if (RULE.test(body)) {
      blocks.push({ type: 'rule' });
      i++;
    } else if (HEADING.test(body)) {
      const [, hashes, text] = HEADING.exec(body);
      blocks.push({ type: 'heading', level: hashes.length, text });
      i++;
    } else if (QUOTE.test(body)) {
      const inner = [];
      while (i < lines.length && QUOTE.test(lines[i].trim()))
        inner.push(QUOTE.exec(lines[i++].trim())[1]);
      blocks.push({ type: 'quote', blocks: parseBlocks(inner) });
    } else if (BULLET.test(body) || NUMBER.test(body)) {
      const [list, next] = takeList(lines, i);
      blocks.push(list);
      i = next;
    } else {
      const para = [];
      while (i < lines.length) {
        const l = lines[i];
        const t = l.trim();
        if (
          !t ||
          FENCE.test(t) ||
          RULE.test(t) ||
          HEADING.test(t) ||
          QUOTE.test(t) ||
          BULLET.test(t) ||
          NUMBER.test(t)
        )
          break;
        para.push(t);
        i++;
      }
      blocks.push({ type: 'para', text: para.join('\n') });
    }
  }
  return blocks;
}

// Inside a list item a paragraph carries no <p> of its own: the item is
// already the block, and the extra tag only adds vertical space.
function renderBlocks(blocks, key, bare = false) {
  return blocks.map((block, n) => {
    const k = `${key}-${n}`;
    switch (block.type) {
      case 'heading': {
        const Tag = `h${Math.min(block.level + 3, 6)}`;
        return (
          <Tag key={k} className="md-heading">
            {renderInline(block.text, k)}
          </Tag>
        );
      }
      case 'rule':
        return <hr key={k} className="md-rule" />;
      case 'code':
        return (
          <pre key={k} className="md-code">
            <code>{block.text}</code>
          </pre>
        );
      case 'quote':
        return (
          <blockquote key={k} className="md-quote">
            {renderBlocks(block.blocks, k)}
          </blockquote>
        );
      case 'list': {
        const Tag = block.ordered ? 'ol' : 'ul';
        return (
          <Tag key={k} className="md-list">
            {block.items.map((item, m) => (
              <li key={`${k}-${m}`}>
                {renderBlocks(parseBlocks(item), `${k}-${m}`, true)}
              </li>
            ))}
          </Tag>
        );
      }
      default:
        return bare ? (
          <React.Fragment key={k}>{renderInline(block.text, k)}</React.Fragment>
        ) : (
          <p key={k}>{renderInline(block.text, k)}</p>
        );
    }
  });
}

export default function Markdown({ text, className }) {
  if (!text) return null;
  const blocks = parseBlocks(String(text).replace(/\r\n?/g, '\n').split('\n'));
  return (
    <div className={className ? `md ${className}` : 'md'}>
      {renderBlocks(blocks, 'md')}
    </div>
  );
}

// The one-line reminder that sits under an edit box, so the syntax is
// discoverable without a help page.
export function MarkdownHint() {
  return (
    <p className="md-hint">
      Markdown supported
    </p>
  );
}
