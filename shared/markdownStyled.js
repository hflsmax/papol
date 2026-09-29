// The styled copy of Markdown as it is typed, for the writing box
// (ui/MarkdownField.jsx): the words exactly as written, each mark wrapped in
// a span that shows what it does, the marks themselves kept faint. Only
// these spans are added; everything typed is escaped.

const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const span = (cls, s) => (s ? `<span class="${cls}">${escape(s)}</span>` : '');
const mark = (s) => span('mdf-mark', s);

// The same inline marks as Markdown.jsx renders, in the same order.
const INLINE = new RegExp([
  '(`)([^`\\n]+)(`)', // 1-3: code
  '(\\*\\*)([^*\\n]+)(\\*\\*)', // 4-6: bold
  '(__)([^_\\n]+)(__)', // 7-9: bold
  '(\\*)([^*\\n]+)(\\*)', // 10-12: italic
  '(_)([^_\\n]+)(_)', // 13-15: italic
  '(~~)([^~\\n]+)(~~)', // 16-18: struck
  '(\\[)([^\\]\\n]*)(\\]\\()([^)\\s]+)(\\))', // 19-23: link
].join('|'), 'g');

function inline(text, depth = 0) {
  let out = '';
  let last = 0;
  const re = new RegExp(INLINE.source, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    // Underscores inside a word are part of the word, as Markdown.jsx has it.
    if ((m[7] || m[13]) && (/\w/.test(text[m.index - 1] || '') || /\w/.test(text[m.index + m[0].length] || ''))) {
      re.lastIndex = m.index + 1;
      continue;
    }
    out += escape(text.slice(last, m.index));
    const inner = (s) => (depth < 3 ? inline(s, depth + 1) : escape(s));
    if (m[1]) out += mark(m[1]) + span('mdf-code', m[2]) + mark(m[3]);
    else if (m[4] || m[7]) out += mark(m[4] ?? m[7]) + `<span class="mdf-b">${inner(m[5] ?? m[8])}</span>` + mark(m[6] ?? m[9]);
    else if (m[10] || m[13]) out += mark(m[10] ?? m[13]) + `<span class="mdf-i">${inner(m[11] ?? m[14])}</span>` + mark(m[12] ?? m[15]);
    else if (m[16]) out += mark(m[16]) + `<span class="mdf-s">${inner(m[17])}</span>` + mark(m[18]);
    else out += mark(m[19]) + `<span class="mdf-link">${inner(m[20])}</span>` + mark(m[21] + m[22] + m[23]);
    last = m.index + m[0].length;
  }
  return out + escape(text.slice(last));
}

const HEADING = /^(\s*#{1,6}\s+)(.*)$/;
const QUOTE = /^(\s*>\s?)(.*)$/;
const ITEM = /^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE = /^\s*```/;

// The styled copy of the words, line by line. Every character typed is in
// it once, in order, so its text is the text.
export function styledMarkdown(text) {
  let fenced = false;
  return text.split('\n').map((line) => {
    if (FENCE.test(line)) {
      fenced = !fenced;
      return mark(line);
    }
    if (fenced) return span('mdf-code mdf-block', line);
    if (RULE.test(line)) return mark(line);
    let m = HEADING.exec(line);
    if (m) return mark(m[1]) + `<span class="mdf-h">${inline(m[2])}</span>`;
    m = QUOTE.exec(line);
    if (m) return mark(m[1]) + `<span class="mdf-q">${inline(m[2])}</span>`;
    m = ITEM.exec(line);
    if (m) return mark(m[1]) + inline(m[2]);
    return inline(line);
  }).join('\n');
}

