/**
 * The words a "Report a problem" from a citation card starts with.
 *
 * The reporter writes what is wrong at the top; everything below the rule
 * is what the card knew at the time, so whoever reads the report can open
 * the same paper, find the same marker, and see what the card showed
 * without asking.
 */
export function citationProblemReport({
  paper = null, page = null, label = null, referenceUuid = null,
  reference = null, error = null, href = '',
} = {}) {
  const work = reference?.resolution;
  const lines = [
    ['Paper', paper && [paper.title, paper.sha256 && `(${paper.sha256})`].filter(Boolean).join(' ')],
    ['Page', page],
    ['Marker', label],
    ['Reference', reference?.uuid || referenceUuid],
    ['Status', reference?.resolved_status],
    ['Error', error],
    ['Printed', reference?.raw],
    ['Matched', work && [
      work.title,
      (work.authors || []).slice(0, 3).join(', '),
      [work.venue, work.year].filter(Boolean).join(' '),
      work.doi || work.url,
    ].filter(Boolean).join(' · ')],
    ['In Papol', reference?.papol_paper_sha256],
    ['Address', href],
  ]
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([name, value]) => `${name}: ${value}`);
  return `\n\n--- Citation card ---\n${lines.join('\n')}\n`;
}
