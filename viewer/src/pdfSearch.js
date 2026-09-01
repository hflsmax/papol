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

// Extract text a page at a time so opening a large document does not launch
// work for every page at once. Periodic yields keep scrolling and controls
// responsive while an explicit search is being prepared.
export async function indexPdfDocument(doc, {
  cancelled = () => false,
  yieldEvery = 4,
  yieldToMain = () => new Promise((resolve) => requestAnimationFrame(resolve)),
} = {}) {
  const pages = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    if (cancelled()) return null;
    pages.push(indexTextItems(content.items));
    if (pageNumber < doc.numPages && pageNumber % yieldEvery === 0) {
      await yieldToMain();
      if (cancelled()) return null;
    }
  }
  return pages;
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
