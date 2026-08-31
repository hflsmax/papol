// PDF text layers expose visual line wrapping as newlines. An excerpt is
// prose, so unwrap those lines while retaining genuine paragraph breaks.
// Citations are removed earlier from their PDF annotation geometry; guessing
// from brackets or digits here would corrupt legitimate scientific text.
export function cleanExcerptText(value) {
  const normalized = String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ');

  return normalized
    // A lowercase continuation after an end-of-line hyphen is ordinarily
    // one word split by page layout, not an authored compound.
    .replace(/([A-Za-z])-[ \t]*\n[ \t]*([a-z])/g, '$1$2')
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.replace(/[ \t]*\n[ \t]*/g, ' '))
    .join('\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .trim();
}
