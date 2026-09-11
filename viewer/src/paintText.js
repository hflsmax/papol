import { STRIP_RATIO } from './ink.js';
import { selectionStrokes } from './selectionInk.js';

// The text under a paint mark.
//
// A mark stores only its geometry — points, width, nib — never the words it
// was laid over, so the words are worked out when they are wanted: a
// character is under the mark when the middle of its box lies inside the
// shape the mark paints. The shape is the one PdfPage draws (a flat nib's
// swept rectangle, a round nib's capsule), and the boxes come from the text
// layer, which is where selection, search highlights and "Paint selected
// text" all take their idea of where a character is. So painting a
// selection and asking the paint for its text gives back that selection,
// whether the mark was made from one or drawn by hand, and wherever it has
// since been moved.
//
// Everything here is in page units — PDF points from the page's top-left
// corner — so zoom and screen never enter it.

const centre = (box) => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 });

// A stroke's points in page units, y down the page.
const strokePoints = (stroke, page) => stroke.points.map((p) => ({
  x: p.x * page.width,
  y: (1 - p.y) * page.height,
}));

// Half the flat nib: wide across the page is thin (its width over the strip
// ratio, never less than a hair), tall is the stroke's weight.
const flatNib = (thick) => ({ hw: Math.max(thick / STRIP_RATIO, 0.2) / 2, hh: thick / 2 });

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Whether p lies in the rectangle (half extents hw, hh) swept from a to b:
// whether some t in [0, 1] puts the rectangle's centre within reach on both
// axes at once.
function sweptRectangleContains(a, b, p, hw, hh) {
  let low = 0;
  let high = 1;
  const within = (delta, offset, half) => {
    if (Math.abs(delta) < 1e-9) return Math.abs(offset) <= half;
    let t1 = (offset - half) / delta;
    let t2 = (offset + half) / delta;
    if (t1 > t2) [t1, t2] = [t2, t1];
    low = Math.max(low, t1);
    high = Math.min(high, t2);
    return low <= high;
  };
  return within(b.x - a.x, p.x - a.x, hw) && within(b.y - a.y, p.y - a.y, hh) && low <= high;
}

// Whether a point (page units) is inside the shape a stroke paints.
export function markContains(stroke, point, page) {
  const thick = stroke.width * page.width;
  const points = strokePoints(stroke, page);
  if (!points.length) return false;
  if (stroke.shape === 'round') {
    const radius = thick / 2;
    if (points.length === 1) return Math.hypot(point.x - points[0].x, point.y - points[0].y) <= radius;
    for (let i = 1; i < points.length; i += 1) {
      if (distanceToSegment(point, points[i - 1], points[i]) <= radius) return true;
    }
    return false;
  }
  const { hw, hh } = flatNib(thick);
  if (points.length === 1) {
    return Math.abs(point.x - points[0].x) <= hw && Math.abs(point.y - points[0].y) <= hh;
  }
  for (let i = 1; i < points.length; i += 1) {
    if (sweptRectangleContains(points[i - 1], points[i], point, hw, hh)) return true;
  }
  return false;
}

// The box a stroke's paint can reach, in page units.
export function markBounds(stroke, page) {
  const thick = stroke.width * page.width;
  const reach = stroke.shape === 'round' ? thick / 2 : Math.max(flatNib(thick).hw, flatNib(thick).hh);
  const points = strokePoints(stroke, page);
  return {
    left: Math.min(...points.map((p) => p.x)) - reach,
    right: Math.max(...points.map((p) => p.x)) + reach,
    top: Math.min(...points.map((p) => p.y)) - reach,
    bottom: Math.max(...points.map((p) => p.y)) + reach,
  };
}

// Pieces of text in reading order, each with the box it came from, joined as
// a reader would copy them: a space between separate words on a line, a line
// break where the next piece starts lower, a blank line at a paragraph gap
// or the start of another page. Selected text is joined the same way.
export function joinTextPieces(pieces) {
  return pieces.map((piece, index) => {
    if (index === 0) return piece.text;
    const previous = pieces[index - 1];
    const newPage = piece.page !== previous.page;
    const newLine = piece.box.top > previous.box.top + previous.box.height * 0.55;
    const paragraphBreak = newPage || piece.box.top - previous.box.bottom >
      Math.max(piece.box.height, previous.box.height) * 0.8;
    const separated = piece.box.left - previous.box.right > 1;
    const needsSpace = !/\s$/.test(previous.text) && !/^\s/.test(piece.text);
    const separator = paragraphBreak ? '\n\n' : newLine ? '\n' : separated ? ' ' : '';
    return `${needsSpace ? separator : ''}${piece.text}`;
  }).join('');
}

// The characters of one page's text layer that could lie inside `within`
// (page units), each { page, span, offset, text, box } in document order.
// Citation markers are left out, as they are from selected text. The page
// element carries its unscaled size (data-page-width/-height), so boxes are
// converted to page units whatever the zoom, or a zoom still in progress.
export function pageCharacters(pageEl, within) {
  const rect = pageEl.getBoundingClientRect();
  const width = Number(pageEl.dataset.pageWidth);
  const height = Number(pageEl.dataset.pageHeight);
  if (!width || !height || !rect.width || !rect.height) return [];
  const sx = width / rect.width;
  const sy = height / rect.height;
  const toPage = (client) => {
    const box = {
      left: (client.left - rect.left) * sx,
      right: (client.right - rect.left) * sx,
      top: (client.top - rect.top) * sy,
      bottom: (client.bottom - rect.top) * sy,
    };
    return { ...box, width: box.right - box.left, height: box.bottom - box.top };
  };
  const page = Number(pageEl.dataset.page);
  const citations = [...pageEl.querySelectorAll('.cite')]
    .map((citation) => toPage(citation.getBoundingClientRect()))
    .filter((box) => box.width > 0 && box.height > 0);
  const characters = [];
  const spans = pageEl.querySelectorAll('.textLayer > span:not(.search-highlight)');
  spans.forEach((span, spanIndex) => {
    const node = span.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const spanBox = toPage(span.getBoundingClientRect());
    if (spanBox.right < within.left || spanBox.left > within.right
      || spanBox.bottom < within.top || spanBox.top > within.bottom) return;
    for (let offset = 0; offset < node.length; offset += 1) {
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      const client = range.getBoundingClientRect();
      range.detach();
      if (!client.width && !client.height) continue;
      const box = toPage(client);
      const middle = centre(box);
      const isCitation = citations.some((c) => (
        middle.x >= c.left - 0.5 && middle.x <= c.right + 0.5
        && middle.y >= c.top - 0.5 && middle.y <= c.bottom + 0.5
      ));
      if (!isCitation) characters.push({ page, span: spanIndex, offset, text: node.data[offset], box });
    }
  });
  return characters;
}

// The text a set of strokes covers. `characters` is every candidate
// character in document order (pageCharacters, page by page), `pages` maps a
// page number to its size in page units. Returns the text, joined as selected
// text is, and one line band per covered stretch of text in the shape
// "Paint selected text" makes — what an excerpt's backlink highlights.
export function textUnderMarks(characters, strokes, pages) {
  const underMark = new Set(characters.filter((character) => {
    const page = pages.get(character.page);
    const middle = centre(character.box);
    return page && strokes.some((stroke) => stroke.page === character.page && markContains(stroke, middle, page));
  }));

  // Whole words, as a reader means them: a word is under the mark when more
  // than half of its letters are. A hand drawing over "for the" clips a
  // letter of the words either side, and those letters are not what it was
  // marking; painting a selection of whole words gives exactly those words.
  const adjacent = (a, b) => a && b && a.page === b.page && a.span === b.span && b.offset === a.offset + 1;
  const kept = new Set();
  let word = [];
  const closeWord = () => {
    if (word.filter((character) => underMark.has(character)).length * 2 > word.length) {
      word.forEach((character) => kept.add(character));
    }
    word = [];
  };
  characters.forEach((character, index) => {
    if (/\s/.test(character.text) || (word.length && !adjacent(characters[index - 1], character))) closeWord();
    if (!/\s/.test(character.text)) word.push(character);
  });
  closeWord();
  // The space between two kept words stays, so they read as one phrase.
  characters.forEach((character, index) => {
    if (/\s/.test(character.text)
      && adjacent(characters[index - 1], character) && adjacent(character, characters[index + 1])
      && kept.has(characters[index - 1]) && kept.has(characters[index + 1])) {
      kept.add(character);
    }
  });
  const covered = characters.filter((character) => kept.has(character));

  const pieces = [];
  for (const character of covered) {
    const last = pieces[pieces.length - 1];
    const continues = last && last.page === character.page
      && last.span === character.span && last.nextOffset === character.offset;
    if (continues) {
      last.text += character.text;
      last.nextOffset += 1;
      last.box.left = Math.min(last.box.left, character.box.left);
      last.box.right = Math.max(last.box.right, character.box.right);
      last.box.top = Math.min(last.box.top, character.box.top);
      last.box.bottom = Math.max(last.box.bottom, character.box.bottom);
      last.box.height = last.box.bottom - last.box.top;
    } else {
      pieces.push({
        page: character.page,
        span: character.span,
        nextOffset: character.offset + 1,
        text: character.text,
        box: { ...character.box },
      });
    }
  }

  const bands = [];
  for (const pageNumber of [...new Set(covered.map((character) => character.page))].sort((a, b) => a - b)) {
    const page = pages.get(pageNumber);
    const box = { left: 0, top: 0, right: page.width, bottom: page.height, width: page.width, height: page.height };
    const rects = covered.filter((character) => character.page === pageNumber).map((character) => character.box);
    bands.push(...selectionStrokes(rects, [{ page: pageNumber, box }]));
  }

  // A loosely drawn mark takes in the spaces either side of its words; those
  // are not text anyone means to keep.
  return { text: joinTextPieces(pieces).trim(), bands };
}
