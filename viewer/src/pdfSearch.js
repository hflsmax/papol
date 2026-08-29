// Turn pdf.js text items into one searchable string while remembering which
// rendered spans contributed each character. That lets a phrase crossing two
// text items still be found and highlighted as one result.
export function indexTextItems(items) {
  let text = '';
  const ranges = [];
  let spanIndex = 0;
  items.forEach((item) => {
    // TextLayer deliberately does not create a span for empty layout items.
    // Counting those was enough to make every highlight after one land on
    // the wrong line even though the search result itself was correct.
    if (!item || typeof item.str !== 'string' || !item.str) return;
    const start = text.length;
    text += item.str;
    ranges.push({ spanIndex, start, end: text.length });
    spanIndex += 1;
    // A visual line ending is whitespace to a reader. Store it as a space so
    // a normal phrase still matches when the PDF split it across two lines.
    text += ' ';
  });
  return { text, ranges };
}

export function findTextMatches(pageIndex, query) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const haystack = pageIndex.text.toLocaleLowerCase();
  const matches = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const start = haystack.indexOf(needle, from);
    if (start < 0) break;
    const end = start + needle.length;
    matches.push({
      parts: pageIndex.ranges
        .filter((range) => range.end > start && range.start < end)
        .map((range) => ({
          spanIndex: range.spanIndex,
          start: Math.max(start, range.start) - range.start,
          end: Math.min(end, range.end) - range.start,
        })),
    });
    from = start + Math.max(1, needle.length);
  }
  return matches;
}
