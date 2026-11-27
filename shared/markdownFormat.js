// What a formatting button does to Markdown being written: the words and
// the selection before, the words and the selection after. Pure, so the
// buttons of a writing box (frontend ThreadComposer.jsx) can be tested
// without a browser. A button pressed again takes its mark back off.

// Wrap the selection in a mark (`**`, `*`, `` ` ``, `~~`), or take the
// mark off when it is already there. With nothing selected, the mark goes
// around a word to write over.
export function wrapSelection({ text, start, end }, mark, placeholder = 'text') {
  const picked = text.slice(start, end);
  const n = mark.length;
  // The marks sit just outside the selection: take them off.
  if (text.slice(start - n, start) === mark && text.slice(end, end + n) === mark) {
    return { text: text.slice(0, start - n) + picked + text.slice(end + n), start: start - n, end: end - n };
  }
  // The selection includes its own marks: take them off.
  if (picked.length >= 2 * n + 1 && picked.startsWith(mark) && picked.endsWith(mark)) {
    const bare = picked.slice(n, -n);
    return { text: text.slice(0, start) + bare + text.slice(end), start, end: start + bare.length };
  }
  const inner = picked || placeholder;
  return { text: text.slice(0, start) + mark + inner + mark + text.slice(end), start: start + n, end: start + n + inner.length };
}

// Start every line the selection touches with a mark (`- `, `> `, `1. `
// counted up), or take it off when every such line has it already.
export function prefixLines({ text, start, end }, kind) {
  const from = text.lastIndexOf('\n', start - 1) + 1;
  const stop = text.indexOf('\n', end);
  const to = stop === -1 ? text.length : stop;
  const lines = text.slice(from, to).split('\n');
  const has = { bullet: /^[-*+]\s+/, number: /^\d+[.)]\s+/, quote: /^>\s?/ }[kind];
  const all = lines.every((line) => has.test(line));
  const next = lines.map((line, at) => {
    if (all) return line.replace(has, '');
    const bare = line.replace(/^(?:[-*+]\s+|\d+[.)]\s+|>\s?)/, '');
    return `${kind === 'bullet' ? '- ' : kind === 'number' ? `${at + 1}. ` : '> '}${bare}`;
  }).join('\n');
  return { text: text.slice(0, from) + next + text.slice(to), start: from, end: from + next.length };
}

// Make the selection a link, the address left selected to write over.
export function linkSelection({ text, start, end }) {
  const picked = text.slice(start, end);
  const address = /^https?:\/\/\S+$/.test(picked);
  const label = address ? 'link' : (picked || 'link');
  const url = address ? picked : 'https://';
  const out = `[${label}](${url})`;
  const at = address ? start + 1 : start + label.length + 3;
  return { text: text.slice(0, start) + out + text.slice(end), start: at, end: at + (address ? label.length : url.length) };
}

// The words alone, for a one-line title: the marks taken off, a link
// left as its words, lines run together.
export function plainWords(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.replace(/^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+|```.*$)/, ''))
    .join(' ')
    .replace(/\[([^\]]*)\]\([^)\s]+\)/g, '$1')
    .replace(/(\*\*|__|~~|`)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?![\w*])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}
