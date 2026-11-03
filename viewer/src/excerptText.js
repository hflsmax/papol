// PDF text layers expose visual line wrapping as newlines. An excerpt is
// prose, so unwrap those lines while retaining genuine paragraph breaks.
// Citations are removed earlier from their PDF annotation geometry; guessing
// from brackets or digits here would corrupt legitimate scientific text.
//
// `knownWords`, when given, is what the rest of the paper spells: a Set (or
// a lookup function) of lowercased words, hyphenated compounds among them.
// It settles a hyphen at a line's end the way a reader would — the paper
// writes "representation" elsewhere, so "represen-/tation" is one word; it
// writes "type-safe", so "type-/safe" keeps its hyphen.
export function cleanExcerptText(value, { knownWords } = {}) {
  const known = typeof knownWords === 'function'
    ? knownWords
    : knownWords ? (word) => knownWords.has(word) : () => false;
  const normalized = String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ');

  return normalized
    // A word broken across lines at a hyphen: rejoin it, keeping the hyphen
    // only where the word is a compound that is written with one.
    .replace(
      /([\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*)([-\u2010\u00ad])[ \t]*\n[ \t]*([\p{L}\p{N}]+)((?:-[\p{L}\p{N}]+)*)/gu,
      (_, left, hyphen, right, chain) => `${left}${keepsHyphen(left, hyphen, right, chain, known) ? '-' : ''}${right}${chain}`,
    )
    // A dash at a line's end that touches its word on the left joins the
    // next word without a space too ("bound—\nand" is "bound—and").
    .replace(/([^\s])([\u2013\u2014])[ \t]*\n[ \t]*(?=\S)/g, '$1$2')
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.replace(/[ \t]*\n[ \t]*/g, ' '))
    .join('\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .trim();
}

// The second halves of compounds papers write with a hyphen ("call-by-
// value", "type-directed"), which a line break alone never made.
const COMPOUND_ENDS = new Set([
  'aware', 'based', 'bound', 'class', 'dependent', 'directed', 'driven', 'free',
  'independent', 'level', 'like', 'oriented', 'order', 'preserving', 'safe',
  'sensitive', 'specific', 'style', 'typed', 'agnostic', 'scale', 'grained',
]);
const COMPOUND_STARTS = new Set(['self', 'well', 'cross', 'semi', 'non', 'multi']);
// Prefixes a typesetter splits off a single word ("un-/like", "in-/dependent").
const WORD_PREFIXES = new Set([
  'a', 'an', 'be', 'co', 'de', 'dis', 'em', 'en', 'ex', 'il', 'im', 'in', 'ir',
  'mis', 'out', 'over', 'pre', 'pro', 're', 'sub', 'super', 'un', 'under', 'up',
  'inter', 'trans', 'counter',
]);
// The first halves of words written closed, which a typesetter breaks where
// the two halves meet ("some-/thing", "how-/ever").
const CLOSED_STARTS = new Set([
  'any', 'every', 'how', 'no', 'some', 'there', 'what', 'when', 'where', 'who', 'with',
]);

function keepsHyphen(left, hyphen, right, chain, known) {
  if (hyphen === '\u00ad') return false; // a soft hyphen is only ever a break
  // "Hindley-/Milner", "x86-/64": a capital or a digit after the hyphen is
  // never the rest of a lowercase word.
  if (!/^\p{Ll}/u.test(right) || /\p{N}$/u.test(left)) return true;
  // A hyphenated chain ("state-of-the-/art", "call-/by-value"): its
  // links all keep theirs.
  if (left.includes('-') || chain) return true;

  const lastPart = left.toLowerCase();
  const tail = right.toLowerCase();
  if (known(`${lastPart}${tail}`)) return false;
  if (known(`${lastPart}-${tail}`)) return true;

  if (WORD_PREFIXES.has(lastPart) || CLOSED_STARTS.has(lastPart)) return false;
  if (COMPOUND_STARTS.has(lastPart)) return true;
  if (COMPOUND_ENDS.has(tail) && lastPart.length >= 3) return true;
  // Two words the paper uses on their own ("sequence", "aligned") are a
  // compound; a fragment ("represen") is not a word the paper writes.
  return lastPart.length >= 3 && tail.length >= 3 && known(lastPart) && known(tail);
}

// The words a page's text spells, lowercased, hyphenated compounds whole —
// the `knownWords` that cleanExcerptText learns a paper's spelling from. A
// word cut by a line's end ("represen-") is not one of them.
export function wordsIn(text, into = new Set()) {
  for (const match of String(text || '').matchAll(/[\p{L}\p{N}]+(?:[-\u2010][\p{L}\p{N}]+)*(?![-\u2010\u00ad\p{L}\p{N}])/gu)) {
    const word = match[0].toLowerCase().replace(/\u2010/g, '-');
    into.add(word);
  }
  return into;
}
