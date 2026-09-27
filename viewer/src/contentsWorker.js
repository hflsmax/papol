import { contentsOfPages } from '../../host/analyzer/src/rules/contents.ts';

// The heading rules, off the page's own thread: laying out a whole paper and
// reading its figures is the one stretch of the work that cannot be broken
// into idle moments, and here it holds up nothing the reader can see.
self.onmessage = (event) => {
  try {
    self.postMessage({ headings: contentsOfPages(event.data.pages) });
  } catch (error) {
    self.postMessage({ error: String(error?.message || error) });
  }
};
