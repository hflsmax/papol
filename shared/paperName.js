// What a paper is called where a person can see it.
//
// A paper is its file, and the file's name is the SHA-256 of its bytes. That
// is 64 characters, which is twice what every other name in Papol costs: a
// user, a room, a board and a shelf are all UUIDs. A paper link was the one
// link that looked like machinery.
//
// So a paper goes by the first half of its digest in a URL — the same 32 hex
// digits a UUID carries, fixed-length, so every link is the same size. This is
// a shortening of the *name*, not of the identity: the paper is still the full
// digest everywhere it is stored, compared, or checked against bytes, and the
// short name is resolved back to it at the first lookup. Nothing downstream of
// that lookup ever sees a short name.
//
// 32 hex digits is 128 bits. Two papers colliding here would need two PDFs
// whose SHA-256 agrees in the first half, which is 2^64 work to find at all
// and 2^128 to aim at a paper somebody already has. The service still checks
// for it rather than assuming, because a name that silently means two things
// is worse than a name that is refused.
export const PAPER_NAME_LENGTH = 32;

// The digest as it is written in a URL.
export function paperName(sha256) {
  return String(sha256 || '').slice(0, PAPER_NAME_LENGTH).toLowerCase();
}

// Both lengths are answered: the short name, and the full digest that older
// links carry. A link someone was handed years ago is still that paper's link.
export const PAPER_NAME_PATTERN = `[0-9a-f]{${PAPER_NAME_LENGTH}}(?:[0-9a-f]{32})?`;

export function isPaperName(value) {
  return new RegExp(`^${PAPER_NAME_PATTERN}$`, 'i').test(String(value || ''));
}
