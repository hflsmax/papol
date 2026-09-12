// Formatting and ordering rules for paper lists, shared by the website's nook
// and library pages and Papol Desktop's list pane.

// "Diffie, Hellman" for two authors or fewer, "Vaswani et al." beyond. The
// field is a JSON array; anything else is shown as it came.
export function formatAuthors(authorsJson) {
  if (!authorsJson) return '';
  try {
    const authors = JSON.parse(authorsJson);
    if (authors.length <= 2) return authors.join(', ');
    return `${authors[0]} et al.`;
  } catch {
    return authorsJson;
  }
}

export const newestFirst = (a, b) => new Date(b.created_at) - new Date(a.created_at);

// Live calls first, then scheduled seminars, then everything else.
export const seminarRank = (paper) =>
  paper.room_status === 'open' || paper.room_status === 'planning'
    ? 0
    : paper.room_status === 'scheduled'
      ? 1
      : 2;
