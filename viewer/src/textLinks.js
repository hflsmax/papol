// Web addresses, email addresses and DOIs printed in a page's text, found
// the way the pdf.js viewer's Autolinker finds them — its patterns and its
// rules — for a PDF whose author did not make them links. pdf.js does not
// export the Autolinker, and its pattern is written with the regular
// expression `v` flag, which the WebKit of older macOS cannot read; these
// are the same classes spelled with `u`. DOIs are Papol's addition: a
// paper's references are full of them, and pdf.js does not look for them.

// pdf.js: /\b(?:https?:\/\/|mailto:|www\.)(?:[\S--[\p{P}<>]]|\/|[\S--[\[\]]]+[\S--[\p{P}<>]])+
//         |(?=\p{L})[\S--[@\p{Ps}\p{Pe}<>]]{1,64}@([\S--[[\p{P}--\-]<>]]{1,63}(?:\.[\S--[[\p{P}--\-]<>]]{1,63})+)/gv
const DOMAIN_PART = '(?:-|[^\\s\\p{P}<>]){1,63}';
const LINK = new RegExp(
  '\\b(?:https?:\\/\\/|mailto:|www\\.)(?:[^\\s\\p{P}<>]|\\/|[^\\s\\[\\]]+[^\\s\\p{P}<>])+'
  + `|(?=\\p{L})[^\\s@\\p{Ps}\\p{Pe}<>]{1,64}@(${DOMAIN_PART}(?:\\.${DOMAIN_PART})+)`,
  'gu',
);
const NUMERIC_TLD = /\.\d+$/;
// A DOI is "10.", a registrant, "/", and anything up to a space. What ends
// a sentence around it is not part of it.
const DOI = /\b(?:doi:\s?)?(10\.\d{4,9}\/[^\s"<>]+)/giu;

// Closing brackets belong to a DOI only when it opened them:
// 10.1016/0370-2693(96)01084-X keeps its ")", "(doi 10.1/x)" does not.
function trimDoi(doi) {
  let text = doi.replace(/[.,;:'"]+$/u, '');
  for (const [open, close] of [['(', ')'], ['[', ']']]) {
    while (text.endsWith(close) && text.split(open).length < text.split(close).length) {
      text = text.slice(0, -1).replace(/[.,;:'"]+$/u, '');
    }
  }
  return text;
}

function httpUrl(raw) {
  try {
    const url = new URL(raw);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** Links in running text, as { href, index, length } into that text. */
export function findTextLinks(text) {
  const found = [];
  for (const match of text.matchAll(LINK)) {
    const [url, emailDomain] = match;
    let raw;
    if (/^(?:https?:\/\/|www\.)/iu.test(url)) {
      raw = url.startsWith('www.') ? `http://${url}` : url;
    } else if (emailDomain) {
      const hostname = httpUrl(`http://${emailDomain}`) && new URL(`http://${emailDomain}`).hostname;
      if (!hostname || NUMERIC_TLD.test(hostname)) continue;
    }
    raw ??= url.startsWith('mailto:') ? url : `mailto:${url}`;
    const href = httpUrl(raw);
    if (href) found.push({ href, index: match.index, length: url.length });
  }
  for (const match of text.matchAll(DOI)) {
    const doi = trimDoi(match[1]);
    const index = match.index + match[0].length - match[1].length;
    const inLink = found.some((link) => index < link.index + link.length && link.index < index + doi.length);
    if (inLink) continue;
    const href = httpUrl(`https://doi.org/${doi}`);
    if (href) found.push({ href, index: match.index, length: index - match.index + doi.length });
  }
  return found.sort((a, b) => a.index - b.index);
}

/**
 * A page's text items as running text, with where each character came from.
 * Items run together as pdf.js's find text does. A line end is a space,
 * except after a hyphen that follows a word, where the line is joined and
 * the hyphen kept — "https://example-\norg.com" is one address — as pdf.js
 * reads text for its Autolinker.
 */
export function runningText(items) {
  let text = '';
  const from = [];
  items.forEach((item, itemIndex) => {
    if (typeof item?.str !== 'string') return;
    for (let offset = 0; offset < item.str.length; offset += 1) {
      text += item.str[offset];
      from.push({ itemIndex, offset });
    }
    if (item.hasEOL && !/\S-$/u.test(text)) {
      text += ' ';
      from.push(null);
    }
  });
  return { text, from };
}

/** A link's characters, as runs within single items: { itemIndex, start, end }. */
export function linkPieces(from, index, length) {
  const pieces = [];
  for (let i = index; i < index + length; i += 1) {
    const at = from[i];
    if (!at) continue;
    const last = pieces[pieces.length - 1];
    if (last && last.itemIndex === at.itemIndex && last.end === at.offset) last.end += 1;
    else pieces.push({ itemIndex: at.itemIndex, start: at.offset, end: at.offset + 1 });
  }
  return pieces;
}
