/**
 * The demo world's papers and located notes — the single source both apps
 * read.
 *
 * Papol's demo (frontend/src/demo.js) turns these into the papers and
 * comments its in-browser API serves; the PDF viewer (viewer/src/source.js)
 * turns the same rows into the anchors it draws. They used to be two
 * hand-copied tables, and a note written into one and not the other showed
 * up in the viewer but not on the paper page.
 *
 * Dates are given as "days ago" so each app can turn them into timestamps
 * at load, keeping the demo world always recent.
 */

export const demoPapers = [
  {
    id: 1,
    doi: '10.1145/357172.357176',
    title: 'The Byzantine Generals Problem',
    authors: '["Leslie Lamport", "Robert Shostak", "Marshall Pease"]',
    journal: 'ACM Transactions on Programming Languages and Systems',
    year: 1982,
    file_path: 'assets/demo/papers/byzantine-generals.pdf',
    daysAgo: 30,
  },
  {
    id: 2,
    doi: '10.48550/arXiv.1706.03762',
    title: 'Attention Is All You Need',
    authors:
      '["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit", "Llion Jones", "Aidan N. Gomez", "Łukasz Kaiser", "Illia Polosukhin"]',
    journal: 'Advances in Neural Information Processing Systems',
    year: 2017,
    file_path: 'assets/demo/papers/attention.pdf',
    daysAgo: 21,
  },
  {
    id: 3,
    doi: '10.1145/3065386',
    title: 'ImageNet Classification with Deep Convolutional Neural Networks',
    authors: '["Alex Krizhevsky", "Ilya Sutskever", "Geoffrey E. Hinton"]',
    journal: 'Communications of the ACM',
    year: 2017,
    file_path: 'assets/demo/papers/alexnet.pdf',
    daysAgo: 18,
  },
  {
    id: 4,
    doi: '10.1145/362384.362685',
    title: 'A Relational Model of Data for Large Shared Data Banks',
    authors: '["E. F. Codd"]',
    journal: 'Communications of the ACM',
    year: 1970,
    file_path: 'assets/demo/papers/codd-relational.pdf',
    daysAgo: 14,
  },
  {
    id: 5,
    doi: '10.1002/j.1538-7305.1948.tb01338.x',
    title: 'A Mathematical Theory of Communication',
    authors: '["Claude E. Shannon"]',
    journal: 'Bell System Technical Journal',
    year: 1948,
    file_path: 'assets/demo/papers/shannon-entropy.pdf',
    daysAgo: 12,
  },
  {
    id: 6,
    doi: '10.1109/TIT.1976.1055638',
    title: 'New Directions in Cryptography',
    authors: '["Whitfield Diffie", "Martin E. Hellman"]',
    journal: 'IEEE Transactions on Information Theory',
    year: 1976,
    file_path: 'assets/demo/papers/diffie-hellman.pdf',
    daysAgo: 9,
  },
  {
    id: 7,
    doi: '10.1016/S0169-7552(98)00110-X',
    title: 'The Anatomy of a Large-Scale Hypertextual Web Search Engine',
    authors: '["Sergey Brin", "Lawrence Page"]',
    journal: 'Computer Networks and ISDN Systems',
    year: 1998,
    file_path: 'assets/demo/papers/pagerank.pdf',
    daysAgo: 6,
  },
  {
    id: 8,
    doi: '10.1145/367177.367199',
    title:
      'Recursive Functions of Symbolic Expressions and Their Computation by Machine, Part I',
    authors: '["John McCarthy"]',
    journal: 'Communications of the ACM',
    year: 1960,
    file_path: 'assets/demo/papers/mccarthy-recursive.pdf',
    daysAgo: 5,
  },
  {
    id: 9,
    doi: '10.1016/0304-3975(75)90017-1',
    title: 'Call-by-name, call-by-value and the λ-calculus',
    authors: '["Gordon D. Plotkin"]',
    journal: 'Theoretical Computer Science',
    year: 1975,
    file_path: 'assets/demo/papers/plotkin-cbn-cbv.pdf',
    daysAgo: 3,
  },
  // Wholly fictional, and written by two of the demo readers — this is
  // where the "this is my paper" tick box shows itself.
  {
    id: 10,
    doi: '10.5555/krabby.2026.001',
    title:
      'Byzantine Fry Cooks: Consensus on the Krabby Patty Formula Under Adversarial Plankton',
    authors: '["SpongeBob SquarePants", "Sandy Cheeks"]',
    journal: 'Proceedings of the Bikini Bottom Symposium on Fry Cook Systems',
    year: 2026,
    file_path: 'assets/demo/papers/byzantine-fry-cooks.pdf',
    daysAgo: 1,
  },
];

/**
 * SpongeBob's notes — a reader's real marginalia: what delighted him and
 * what he could not follow, rather than a summary of the paper. Every one
 * is located: a page and a point on it, as
 * fractions of the page in PDF user space. A note with no `content` is a
 * bare anchor — a mark he has not written on yet — and `currentPlace`
 * marks where he stopped reading.
 *
 * Only papers he keeps appear here: a visitor can open no others.
 */
export const demoNotes = [
  {
    id: 1,
    paperId: 1,
    page: 3,
    x: 0.34,
    y: 0.455,
    daysAgo: 27,
    content:
      "Wait — why can't three generals manage it? I have read this page twice and I still do not see what goes wrong.",
  },
  {
    id: 2,
    paperId: 1,
    page: 4,
    x: 0.62,
    y: 0.185,
    daysAgo: 25,
    content:
      'They send you to another paper for the proof! I wanted to see it here.',
  },
  {
    id: 3,
    paperId: 1,
    page: 9,
    x: 0.36,
    y: 0.215,
    daysAgo: 22,
    content:
      'Lost me completely. Why does signing a message fix everything? Ask Sandy.',
  },
  { id: 4, paperId: 1, page: 5, x: 0.3, y: 0.6, daysAgo: 21, content: '' },
  {
    id: 5,
    paperId: 1,
    page: 7,
    x: 0.34,
    y: 0.52,
    daysAgo: 20,
    content: '',
    currentPlace: true,
  },
  {
    id: 6,
    paperId: 2,
    page: 4,
    x: 0.28,
    y: 0.86,
    daysAgo: 19,
    content:
      'Everyone warned me this paper was hard, and this part is not hard at all!',
  },
  {
    id: 7,
    paperId: 2,
    page: 6,
    x: 0.3,
    y: 0.62,
    daysAgo: 18,
    content:
      'Why sines and cosines? They say it works and then move on. I am taking it personally.',
  },
  { id: 8, paperId: 2, page: 7, x: 0.32, y: 0.55, daysAgo: 17, content: '' },
  {
    id: 9,
    paperId: 2,
    page: 9,
    x: 0.36,
    y: 0.5,
    daysAgo: 16,
    content: '',
    currentPlace: true,
  },
  {
    id: 10,
    paperId: 10,
    page: 2,
    x: 0.33,
    y: 0.815,
    daysAgo: 1,
    content: 'Sandy wrote this page. Best page in any paper, anywhere.',
  },
];

/** The same row, in the shape the API returns for a note. */
export function noteAsComment(note, userId, daysAgoToDate) {
  return {
    id: note.id,
    paper_id: note.paperId,
    user_id: userId,
    content: note.content,
    page: note.page,
    anchor_type: 'point',
    anchor: { type: 'point', x: note.x, y: note.y },
    current_place: !!note.currentPlace,
    created_at: daysAgoToDate(note.daysAgo),
  };
}
