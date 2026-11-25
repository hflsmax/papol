// Terms the reader defined (cloudflare/src/routes/terms.ts): words they
// selected and pointed at a definition printed in the same paper. Wherever
// the words are read, they are a link to that definition, shown as a named
// rule is at its mention (the telescope) and gone to by a press.
//
// A term is matched in a page's running text as a reader would find it:
// case and spacing aside, whole words only, and its plural with it
// ("redex" finds "redexes"). A symbol is found in whatever letters the
// paper sets it, in its own case. Of two terms that begin at one place
// the longer is meant.

import limits from '../../shared/appLimits.js';

const { term_length_max: TERM_MAX } = limits.defined_terms;
// More words than this is a passage, not a term.
const TERM_WORDS_MAX = 8;

const LETTER = '\\p{L}\\p{N}';
const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A term as it is matched: case and spacing aside. The Worker's `termKey`.
export const termKey = (term) => String(term ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Selected text as a term to define: on one line, without the punctuation
 * a selection picks up at its ends. Null for what is no term: nothing with
 * a letter in it, or a passage.
 */
export function definableTerm(text) {
  let term = String(text ?? '').replace(/\s+/g, ' ').trim();
  // A bracket at an end goes unless the term holds its other half: "(redex)"
  // is redex, "f(x)" is itself.
  const count = (marks) => [...term].filter((c) => marks.includes(c)).length;
  for (let before = null; before !== term;) {
    before = term;
    term = term.replace(/^[\s.,;:!?'"“”‘’]+|[\s.,;:!?'"“”‘’]+$/gu, '');
    if (/^[([{]/u.test(term) && (count('([{') > count(')]}') || /[)\]}]$/u.test(term))) term = term.slice(1);
    if (/[)\]}]$/u.test(term) && count(')]}') > count('([{')) term = term.slice(0, -1);
  }
  if (!term || term.length > TERM_MAX || !new RegExp(`[${LETTER}]`, 'u').test(term)) return null;
  if (term.split(' ').length > TERM_WORDS_MAX) return null;
  return term;
}

// A term as its pattern is built from it: every character in its plain form,
// spacing aside, its case kept.
const plainTerm = (term) => String(term ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();

// A symbol rather than words: set in mathematical letters ("𝜏𝑃"), or with no
// word of three letters in it ("Γ ⊢ e"). A symbol's case is part of it — τP
// is not τp — and it has no plural.
function isSymbol(term) {
  const spaced = String(term ?? '').replace(/\s+/g, ' ').trim();
  return spaced !== plainTerm(spaced) || !/\p{L}{3}/u.test(spaced);
}

function termPattern(term) {
  const symbol = isSymbol(term);
  const words = plainTerm(term).split(' ').map(escaped);
  const first = new RegExp(`^[${LETTER}]`, 'u').test(words[0]);
  const last = words[words.length - 1];
  const lettered = new RegExp(`[${LETTER}]$`, 'u').test(last);
  const plural = !symbol && /\p{L}$/u.test(last) ? '(?:e?s)?' : '';
  // A line that ends on a hyphen is joined to the next (textLinks.js), so
  // a space in the term may be none in the text after one.
  return new RegExp(
    `${first ? `(?<![${LETTER}])` : ''}${words.join('(?:\\s+|(?<=-))')}${plural}${lettered ? `(?![${LETTER}])` : ''}`,
    symbol ? 'gu' : 'giu',
  );
}

// Text with every character in its plain form, as a term's pattern has it:
// a paper's mathematics is set in letters of its own ("𝜏" for τ, "ﬁ" for fi)
// that read the same. With where each plain character begins and ends in
// the text given.
function plainText(text) {
  let plain = '';
  const starts = [];
  const ends = [];
  for (let i = 0; i < text.length;) {
    const char = String.fromCodePoint(text.codePointAt(i));
    const folded = char.normalize('NFKC');
    for (let k = 0; k < folded.length; k += 1) {
      starts.push(i);
      ends.push(i + char.length);
    }
    plain += folded;
    i += char.length;
  }
  return { plain, starts, ends };
}

/** Where terms are printed in running text: [{ term, index, length }], in order, none over another. */
export function findTerms(text, terms) {
  const found = [];
  const { plain, starts, ends } = plainText(text);
  for (const term of terms) {
    if (!termKey(term.term)) continue;
    for (const match of plain.matchAll(termPattern(term.term))) {
      if (!match[0]) continue;
      const index = starts[match.index];
      found.push({ term, index, length: ends[match.index + match[0].length - 1] - index });
    }
  }
  found.sort((a, b) => a.index - b.index || b.length - a.length);
  const kept = [];
  for (const one of found) {
    const last = kept[kept.length - 1];
    if (!last || one.index >= last.index + last.length) kept.push(one);
  }
  return kept;
}

/**
 * The paper's definitions, for the reader to choose a term's from: each
 * with the name the paper gives it, what it is about, and where it is
 * printed whole, in reading order.
 */
export function definitionsIn(floats = []) {
  return floats
    .filter((float) => float.kind === 'definition')
    .map((float) => ({
      uuid: float.uuid,
      label: float.label,
      title: float.title || null,
      page: float.page,
      box: float.whole ?? { x: float.x, y: float.y, w: float.w, h: float.h },
      y: float.y,
    }))
    .sort((a, b) => a.page - b.page || a.y - b.y);
}

/** A term's link target: where a press goes and what the telescope shows. */
export const termSpot = (term) => ({ page: term.page, y: term.box.y, kind: 'term', box: term.box });
