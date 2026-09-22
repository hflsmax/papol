// The papers a board's cards come from.
//
// A clip or an excerpt sent from the viewer keeps a backlink to the page it
// was taken from: the viewer's own address, `/viewer/?pdf=<sha256>&page=…`,
// with a label reading "<title>, page <n>". The digest in that address is
// what names the paper everywhere else in Papol, so it is what makes two
// cards "from the same paper". A card with any other source — a webpage, a
// video, a file dropped on the board — comes from no paper.

const DIGEST = /^[0-9a-f]{64}$/i;

export function sourcePaperSha256(item) {
  if (!item?.source_url) return null;
  try {
    const url = new URL(item.source_url);
    if (!url.pathname.includes('/viewer/')) return null;
    const pdf = url.searchParams.get('pdf');
    return pdf && DIGEST.test(pdf) ? pdf.toLowerCase() : null;
  } catch {
    return null;
  }
}

// "Attention Is All You Need, page 3" names the paper the card came from.
const titleFromLabel = (label) => (label || '').replace(/,\s*page\s+\d+\s*$/i, '').trim();

// Each distinct paper the board's cards come from, in the order its first
// card was laid down, with what is known of it: the paper's own record when
// the board carries one (`board.papers`), else the title its cards were
// labelled with.
export function boardSourcePapers(board) {
  const known = new Map((board?.papers || []).map((paper) => [String(paper.sha256).toLowerCase(), paper]));
  const found = new Map();
  for (const item of board?.items || []) {
    const sha256 = sourcePaperSha256(item);
    if (!sha256 || found.has(sha256)) continue;
    const paper = known.get(sha256);
    found.set(sha256, {
      sha256,
      title: paper?.title || titleFromLabel(item.source_label) || 'Untitled paper',
      authors: paper?.authors ?? null,
      year: paper?.year ?? null,
    });
  }
  return [...found.values()];
}

export function boardSourceDigests(items) {
  return [...new Set((items || []).map(sourcePaperSha256).filter(Boolean))];
}
