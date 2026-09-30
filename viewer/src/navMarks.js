import navMarks from '../../config/nav_marks.json' with { type: 'json' };
import { positionOf } from './sectionStops.js';

/**
 * What the nav bar can mark above its strip, in the order the gear lists
 * them, and what each is called there. The kinds and the set shown out of
 * the box are the account's (config/nav_marks.json), so the Worker and the
 * viewer agree on them.
 */
export const NAV_KINDS = navMarks.kinds;
export const NAV_SHOWN = navMarks.shown;

export const NAV_NAMES = {
  subsection: 'Subsections',
  figure: 'Figures',
  table: 'Tables',
  algorithm: 'Algorithms and code',
  definition: 'Definitions',
  theorem: 'Theorems',
  lemma: 'Lemmas',
  proof: 'Proofs',
};

// The analysis's kinds, by the kind the bar marks them as. A box (Nature's
// "Box 1") is set like a figure and read like one; a listing is code, as an
// algorithm is.
const KIND_OF = {
  figure: 'figure', box: 'figure', table: 'table', algorithm: 'algorithm', listing: 'algorithm',
  definition: 'definition', theorem: 'theorem', lemma: 'lemma', proof: 'proof',
};
const PRINTED = { figure: 'Figure', box: 'Box', table: 'Table', algorithm: 'Algorithm', listing: 'Listing' };

/**
 * The analysis's floats as marks on the bar: the kinds `shown` asks for,
 * each at its place in document units (see sectionStops), with the name
 * its tooltip gives it: number and caption or title. Subsections are not among them: they come from the
 * outline, as the sections do.
 */
export function floatMarks(floats = [], shown = NAV_SHOWN, pages = 0) {
  return floats
    .filter((float) => KIND_OF[float.kind] && shown.includes(KIND_OF[float.kind]))
    .map((float) => ({
      id: float.uuid,
      kind: KIND_OF[float.kind],
      // A statement's label is already its name ("Lemma 2"); a float's is
      // its number. What it is about follows: its caption, a theorem's
      // name or opening words.
      name: [PRINTED[float.kind] ? `${PRINTED[float.kind]} ${float.label}` : float.label, float.title].filter(Boolean).join(': '),
      page: float.page,
      // At the middle of its box (measured from the top of its page): a
      // press on the mark brings that middle to the middle of the window,
      // so the figure stands centred and the marker stands on the mark.
      at: positionOf(float.page, 1 - float.y - (float.h ?? 0) / 2),
    }))
    .filter((mark) => mark.at >= 0 && (!pages || mark.at < pages))
    .sort((a, b) => a.at - b.at);
}
