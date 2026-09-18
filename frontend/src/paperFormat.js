// Formatting and ordering rules for paper lists, shared by the website's nook
// and library pages and Papol macOS's list pane.

// A paper's authors are kept as a JSON list; an empty field is no authors.
export function authorList(authorsJson) {
  return authorsJson ? JSON.parse(authorsJson) : [];
}

// "Diffie, Hellman" for two authors or fewer, "Vaswani et al." beyond.
export function formatAuthors(authorsJson) {
  const authors = authorList(authorsJson);
  if (authors.length <= 2) return authors.join(', ');
  return `${authors[0]} et al.`;
}

export const newestFirst = (a, b) => new Date(b.created_at) - new Date(a.created_at);

// Live calls first, then scheduled seminars, then everything else.
export const seminarRank = (paper) =>
  paper.room_status === 'open' || paper.room_status === 'planning'
    ? 0
    : paper.room_status === 'scheduled'
      ? 1
      : 2;
